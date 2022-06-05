/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import {
	createConnection, TextDocuments, TextDocumentSyncKind,BrowserMessageReader,BrowserMessageWriter,
    Diagnostic, DiagnosticSeverity,
    CodeActionKind,
    CodeActionParams,
    CodeAction
} from 'vscode-languageserver/browser';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import * as glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import fileUriToPath from './fileUriToPath';

import { LogicManager } from '@accordproject/ergo-compiler';
import { ModelFile } from '@accordproject/concerto-core';
import { TemplateMarkTransformer } from '@accordproject/markdown-template';
import { CiceroMarkTransformer } from '@accordproject/markdown-cicero';
import { quickfix } from './CodeActionProvider';

const util = require('util');


const messageReader = new BrowserMessageReader(self);
const messageWriter = new BrowserMessageWriter(self);

const connection = createConnection(messageReader,messageWriter);

// Create a manager for open text documents
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// The workspace folder this server is operating on
let workspaceFolder: string;

// an empty range (this will highlight the first word in the document)
const FULL_RANGE = {
    start: { line: 0, character: 0 },
    end:  { line: 0, character: 0 },
};

/**
 * A cache of LogicManager/template instances. The keys are the root folder names.
 * Values have a logicManager, parserManager, templateModel and data properties
 */
const templateCache = {};

function getTemplateModel(parentDir) {
    const entry = templateCache[parentDir];
    if(entry) {
        return entry.templateModel;
    }
}

/**
 * Gets the root file path for a template or set of models, from a path under the root, 
 * by walking up the directory hierarchy looking for a package.json file. If the file
 * is not found then directory containing pathStr is returned.
 * @param {string} pathStr the full path
 * @param {TextDocument} textDocument the textDocument we are processing
 * @returns {string} the root file path
 */
function getProjectRoot(pathStr) {

    let currentPath = pathStr;

    console.log(currentPath)

    while(currentPath !== '/' && currentPath.split(":").pop() !== '\\') {
        // connection.console.log( `- ${currentPath}`);

        try {
            getEditedFileContents(currentPath + '/package.json');
            connection.console.log( `Project root is: ${currentPath}`);
            return currentPath;
        }
        catch(err) {
            // connection.console.log( `- exception ${err}`);
        }
        currentPath = path.normalize(path.join(currentPath, '..'));
    }
    return path.basename(path.dirname(pathStr));
}

/**
 * Returns true if the project root contains a package.json that
 * defines an AP template
 * @param pathStr the project root
 * @returns {boolean} true if the project is a template
 */
function isTemplate(pathStr) {
    try {
        const packageJson = getEditedFileContents(pathStr + '/package.json');
        return JSON.parse(packageJson).accordproject;
    }
    catch(err) {
    }
    return false;
}

/**
 * Gets an open document by path
 * @param path the path to the file
 * @returns {TextDocument} the open text document or null
 */
function getDocument(path) {
    const key = 'file://' + path;
    return documents.get(key);
}

/**
 * Finds the asset declaration in the model manager for a clause or contract
 * @param modelManager the modelManager
 * @returns {*} class declaration for the template model, or null
 */
function findTemplateModel(modelManager) {
    const assets = modelManager.getAssetDeclarations();
    const templateModels = assets.filter(asset => {
        const superTypes = asset.getAllSuperTypeDeclarations()
        const found = superTypes.filter( superType => {
            const fqn = superType.getFullyQualifiedName();
            connection.console.log(`- fqn ${fqn}`);
            return fqn === 'org.accordproject.cicero.contract.AccordClause' ||
                fqn === 'org.accordproject.cicero.contract.AccordContract';
        });

        return (found.length > 0);
    });

    if(templateModels.length > 0) {
        return templateModels[0];
    }
    else {
        return null;
    }
}

/**
 * Returns the contents of a file from disk, or if the file
 * has been opened for editing, then the edited contents is returned.
 * @param file the path to the file
 * @returns {string} the contents of the file
 */
function getEditedFileContents(file) {

    const document = getDocument(file);

    // connection.console.log(`Getting ${key}`)

    if(document) {
        // connection.console.log(`- returning editor content`)
        return document.getText();
    }
    else {
        // connection.console.log(`- returning file system content`)
        return fs.readFileSync(file, 'utf8');    
    }
}

/**
 * Extract line numbers from exceptions
 * 
 * @param error the exception
 * @returns the range object
 */
function getRange(error: any) {
    if(error.fileLocation) {
        return {
            start: { line: error.fileLocation.start.line-1, character: error.fileLocation.start.column },
            end: { line: error.fileLocation.end.line-1, character: error.fileLocation.end.column }
        };
    }
    
    return FULL_RANGE;
}

/**
 * Converts an error (exception) to a VSCode Diagnostic and
 * pushes it onto the diagnosticMap
 * @param severity the severity level for the diagnostic
 * @param textDocument the text document associated (the doc that has been modified)
 * @param error the exception
 * @param type the type of the exception
 */
function pushDiagnostic(severity, textDocument: TextDocument, error : any, type : string, diagnosticMap) {

    connection.console.log(util.inspect(error, false, null))

    let fileName = error.fileName;

    let diagnostic: Diagnostic = {
        severity,
        range: getRange(error),
        message: error.message,
        source: type
    };

    // last resort, we assume the error is related
    // to the document that was just changed
    if(!fileName) {
        fileName = textDocument.uri;
    }

    // add the diagnostic
    if(!diagnosticMap[fileName]) {
        diagnosticMap[fileName] = new Set();
    }
    
    diagnosticMap[fileName].add(diagnostic);
}

/**
 * Declares that a file has no errors in the diagnostic map.
 * We need to call this on all files that DO NOT have errors
 * to ensure that error markers are removed.
 * 
 * @param fileName the uri of the file
 * @param diagnosticMap the diagnostic map
 */
function clearErrors(fileName, type, diagnosticMap) {

    const errors = diagnosticMap[fileName];

    if(!errors) {
        diagnosticMap[fileName] = new Set();
    }
    else {
        errors.forEach(function(error){
            if (error.source === type) {
              errors.delete(error);
            }
          });
    }
}

/**
 * Called when a document is opened
 */
documents.onDidOpen((event) => {
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
})

/**
 * Connect the document connection to the client
 */

documents.listen(connection);

/**
 * Called when the extension initializes
 */
connection.onInitialize((params) => {
	workspaceFolder = params.rootUri;
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Full
            },
            codeActionProvider : {
                codeActionKinds: [CodeActionKind.QuickFix]
            }
		}
	}
});

connection.onCodeAction(provideCodeActions);

async function provideCodeActions(params: CodeActionParams): Promise<CodeAction[]> {
    connection.console.log(`*** provideCodeActions ${params.textDocument.uri}`);

    if (!params.context.diagnostics.length) {
        return [];
    }
    const textDocument = documents.get(params.textDocument.uri);
    if (!textDocument) {
        return []; 
    }

    const pathStr = path.resolve(fileUriToPath(textDocument.uri));
    const parentDir = getProjectRoot(pathStr);
    connection.console.log(`- project root: ${parentDir}`);

    const modelFilePath = parentDir + '/model/model.cto';
    connection.console.log(`- modelFilePath: ${modelFilePath}`);

    const modelDocument = getDocument(modelFilePath);
    if (!modelDocument) {
        return [];
    }

    connection.console.log(`- model document: ${modelDocument}`);

    const templateModel = getTemplateModel(parentDir);

    if (!templateModel) {
        return [];
    }
    return quickfix(connection, templateModel, modelDocument, params);
}

/**
 * The content of a text document has changed. This event is emitted
 * when the text document is first opened or when its content has changed.
 */
documents.onDidChangeContent(async () => {
	  // Revalidate any open text documents
    documents.all().forEach(validateTextDocument);
});

/**
 * Called when the contents of a document changes
 * 
 * @param textDocument - a TextDocument
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {

    try {
        const pathStr = path.resolve(fileUriToPath(textDocument.uri));
        const fileExtension = path.extname(pathStr);
        const basename = path.basename(pathStr);

        connection.console.log(`*** Document modified: ${textDocument.uri}`);

        /**
         * Map of diagnostics, with the key being the document URI
         * and the value being a Set of Diagnostic instances
         */
        const diagnosticMap = {
        }
        // this will assemble all the models into a ModelManager
        // and validate - so it needs to always run before we do anything else
        const projectRoot = getProjectRoot(pathStr);
        const modelValid = await validateModels(textDocument, diagnosticMap, templateCache);
        let ergoValid = true;

        // if the model is valid, then we proceed
        if(modelValid && isTemplate(projectRoot)) {

            if(basename === 'grammar.tem.md' || fileExtension === '.cto' || fileExtension === '.ergo') {
                ergoValid = await compileErgoFiles(textDocument, diagnosticMap, templateCache);    
            }

            if(ergoValid) {
                // check the sample is valid
                await parseSampleFile(textDocument, diagnosticMap, templateCache);
            }
        }
        else {
            connection.console.log(`- package.json does not declare a template: ${projectRoot}`);
        }
    
        // send all the diagnostics we have accumulated back to the client
        Object.keys(diagnosticMap).forEach(function(key) {
            const fileDiagnostics : Set<Diagnostic> = diagnosticMap[key];
            connection.sendDiagnostics({ uri: key, diagnostics : [...fileDiagnostics] });
          });
    }
    catch(error) {
        connection.console.error(error.message);
        connection.console.error(error.stack);
    }
}

/**
 * Validate a change to an ergo file: we recompile all ergo files.
 * 
 * @param textDocument - a TextDocument (Ergo file or a CTO file)
 * @return Promise<boolean> true the ergo files are valid
 */
async function compileErgoFiles(textDocument: TextDocument, diagnosticMap, templateCache): Promise<boolean> {

    try {
        const pathStr = path.resolve(fileUriToPath(textDocument.uri));
        const folder = pathStr.substring(0,pathStr.lastIndexOf("/")+1);
        const parentDir = getProjectRoot(pathStr);

        if(!isTemplate(parentDir)) {
            return false;
        }

        try {
            // get the template logic from cache
            let logicManager = templateCache[parentDir].logicManager;
            connection.console.log(`*** Compiling ergo files under: ${parentDir}`);
    
            // Find all ergo files in ./ relative to this file
            const ergoFiles = glob.sync(`{${folder},${parentDir}/logic/}**/*.ergo`);
            for (const file of ergoFiles) {
                clearErrors(file, 'logic', diagnosticMap);
                const contents = getEditedFileContents(file);
                connection.console.log(`- ${file}`)
                logicManager.updateLogic(contents, file);
            }
            await logicManager.compileLogic(true);
            return true;
        } catch (error) {
            pushDiagnostic(DiagnosticSeverity.Error, textDocument, error, 'logic', diagnosticMap);
        }
    }
    catch(error) {
        connection.console.error(error.message);
        connection.console.error(error.stack);
    }

    return false;
}

/**
 * Rebuild the model manager and validates all the models. Models are cached
 * in the template cache.
 * 
 * @param textDocument - a TextDocument
 * @return Promise<boolean> true the model is valid
 */
async function validateModels(textDocument: TextDocument, diagnosticMap, templateCache): Promise<boolean> {
    const pathStr = path.resolve(fileUriToPath(textDocument.uri));
    const folder = pathStr.substring(0,pathStr.lastIndexOf("/")+1);

    try {
        const parentDir = getProjectRoot(pathStr);
        connection.console.log(`*** Validating model files under: ${parentDir}`);

        // get the template logic from cache
        const logicManager = new LogicManager('es6');
        const cacheEntry = {
            logicManager,
            parserManager: null,
            data: null,
            templateModel : null
        }

        templateCache[parentDir] = cacheEntry;
        
        const modelManager = logicManager.getModelManager();
        modelManager.clearModelFiles();
    
        // Find all cto files in ./ relative to this file or in the parent directory if this is a Cicero template.
        const modelFiles = glob.sync(`{${folder},${parentDir}/model/}**/*.cto`);

        // validate the model files
        try {
            for (const file of modelFiles) {
                clearErrors(file, 'model', diagnosticMap);
                const contents = getEditedFileContents(file);
                const modelFile: any = new ModelFile(modelManager, contents, file);
                connection.console.log(`- ${file}`)
                if (!modelManager.getModelFile(modelFile.getNamespace())) {
                    modelManager.addModelFile(contents, file, true);
                } else {
                    modelManager.updateModelFile(contents, file, true);
                }
            }

            // download external dependencies and validate
            try {
                connection.console.log(`Downloading external models`)
                await modelManager.updateExternalModels();
                connection.console.log(`Downloading completed.`)
            }
            catch(err) {
                // we may be offline? Validate without external models
                connection.console.log(`Failed to download external models. Assuming offline. ${err}`);
                modelManager.validateModelFiles();
                pushDiagnostic(DiagnosticSeverity.Warning, textDocument, err, 'model', diagnosticMap);
            }

            cacheEntry.templateModel = findTemplateModel(modelManager);
            return true;
        }
        catch(error) {
            pushDiagnostic(DiagnosticSeverity.Error, textDocument, error, 'model', diagnosticMap);
        }
    }
    catch(error) {
        connection.console.error(error.message);
        connection.console.error(error.stack);
    }

    return false;
}

/**
 * Validate the grammar.tem.md file
 * 
 * @param textDocument - a TextDocument. WARNING, this may not be the .tem file!
 * @return Promise<boolean> true if the grammar file is valid
 */

/**
 * Parse sample.md
 * 
 * @param textDocument - a TextDocument. WARNING, this may not be the sample.md file!
 * @return Promise<boolean> true the sample.md file is valid wrt to the grammar
 */
async function parseSampleFile(textDocument: TextDocument, diagnosticMap, templateCache): Promise<boolean> {

    try {
        const pathStr = path.resolve(fileUriToPath(textDocument.uri));
        const parentDir = getProjectRoot(pathStr);
        if(!isTemplate(parentDir) || !templateCache[parentDir] || !templateCache[parentDir].parserManager) {
            return false;
        }

        const samplePath = parentDir + '/text/sample.md';
        const parserManager = templateCache[parentDir].parserManager;

        if(!parserManager) {
            return false;
        }

        connection.console.log(`*** Validating sample file ${pathStr}`);
        clearErrors(samplePath, 'sample', diagnosticMap);
        
        try {
            const templateMarkTransformer = new TemplateMarkTransformer();

            // Transform text to ciceromark
            const ciceroMarkTransformer = new CiceroMarkTransformer();
            const sample = getEditedFileContents(samplePath);
            const inputCiceroMark = ciceroMarkTransformer.fromMarkdownCicero(sample);
    
            // Parse
            const data = templateMarkTransformer.dataFromCiceroMark({ fileName:samplePath, content:inputCiceroMark }, parserManager, {});
            connection.console.log(`Parsed sample.md: ${JSON.stringify(data, null, 2)}`);
            templateCache[parentDir].data = data;
            return true;
        }
        catch(error) {
            templateCache[parentDir].data = null;
            error.fileName = samplePath;
            pushDiagnostic(DiagnosticSeverity.Error, textDocument, error, 'sample', diagnosticMap);
        }
    }
    catch(error) {
        connection.console.error(error.message);
        connection.console.error(error.stack);
    }

    return false;
}

connection.listen();