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

import * as path from 'path';


import * as vscode from 'vscode';

import { ExtensionContext, Uri } from 'vscode';

import { LanguageClient ,LanguageClientOptions } from 'vscode-languageclient/browser';

import {
	downloadModels,
	exportClassDiagram,
	getWebviewContent,
	setOutputChannel
} from './commandHandlers';

let client: LanguageClient;

async function onDocumentChange(event) {
	if (event.document.languageId === 'ciceroMark' || event.document.languageId === 'concerto') {
		return getWebviewContent();;
	}

	return null;
}

export function activate(context: vscode.ExtensionContext) {

	// Set the process.browser variable so that the Concerto logger doesn't try to create log files
	(process as any).browser = true;


	/* 
	 * all except the code to create the language client in not browser specific
	 * and couuld be shared with a regular (Node) extension
	 */
	const documentSelector = [{
		scheme: 'file',
		language: 'ergo'
	},
	{
		scheme: 'file',
		language: 'concerto'
	},
	{
		scheme: 'file',
		language: 'ciceroMark'
	},
	{
		scheme: 'file',
		language: 'markdown',
		pattern: '**/sample*.md'
	}]

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		documentSelector,
		synchronize: {
			// Synchronize the setting section 'Cicero' to the server
			configurationSection: 'Cicero',
			// Notify the server about file changes to '.clientrc files contain in the workspace
			fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
		},
		initializationOptions: {}
	};

	const client = createWorkerLanguageClient(context, clientOptions);

	const disposable = client.start();
	context.subscriptions.push(disposable);

	client.onReady().then(() => {
		console.log('lsp-web-extension-sample server is ready');
	});



	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used

	// create the output channel
	const outputChannel = vscode.window.createOutputChannel('Cicero');
	setOutputChannel(outputChannel);

	// Register commands

	context.subscriptions.push(vscode.commands
		.registerCommand('cicero-vscode-extension.downloadModels', downloadModels));
	context.subscriptions.push(vscode.commands
		.registerCommand('cicero-vscode-extension.exportClassDiagram', exportClassDiagram));

	let currentPanel: vscode.WebviewPanel | undefined = undefined;

	context.subscriptions.push(
		vscode.commands.registerCommand('cicero-vscode-extension.showPreview', async (file: vscode.Uri) => {
			const columnToShowIn = vscode.ViewColumn.Beside;

			if (currentPanel) {
				// If we already have a panel, show it in the target column
				currentPanel.reveal(columnToShowIn);
			} else {
				// Otherwise, create a new panel
				currentPanel = vscode.window.createWebviewPanel(
					'cicero',
					'Accord Project Preview',
					columnToShowIn, {
						enableScripts: true
					  }
				);

				currentPanel.webview.html = await getWebviewContent();

				// Reset when the current panel is closed
				currentPanel.onDidDispose(
					() => {
						currentPanel = undefined;
					},
					null,
					context.subscriptions
				);

				// update the preview when the text document changes
				vscode.workspace.onDidChangeTextDocument( async (event) => {
					const content = await onDocumentChange(event);
					if(content) {
						currentPanel.webview.html = content;
					}
				});

				// update the preview when the active editor changes
				vscode.window.onDidChangeActiveTextEditor( async (event) => {
					const content = await onDocumentChange(event);
					if(content) {
						currentPanel.webview.html = content;
					}
				});
			}
		})
	);


}

function createWorkerLanguageClient(context: ExtensionContext, clientOptions: LanguageClientOptions) {
	// Create a worker. The worker main file implements the language server.
	const serverMain = Uri.joinPath(context.extensionUri, 'server/dist/browserServerMain.js');

	// create the language server client to communicate with the server running in the worker
	return new LanguageClient('lsp-web-extension-sample', 'LSP Web Extension Sample', clientOptions, null);
}

export function deactivate(): Thenable < void > | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}




