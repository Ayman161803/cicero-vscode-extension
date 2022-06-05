/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/


const NodePolyfillPlugin = require("node-polyfill-webpack-plugin")
const path = require('path');
const webpack = require('webpack');

/** @type WebpackConfig */
const browerClientConfig = {
	mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
	target: 'webworker', // extensions run in a webworker context
	entry: {
		'extension': './client/src/browserClientMain.ts',
		// 'test/suite/index': './src/web/test/suite/index.ts'
	},
	output: {
		filename: 'browserClientMain.js',
		path: path.join(__dirname,'client','dist'),
		libraryTarget: 'commonjs',
		devtoolModuleFilenameTemplate: '../../[resource-path]'
	},
	resolve: {
		mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
		extensions: ['.ts', '.js'], // support ts-files and js-files
		alias: {
			// provides alternate implementation for node module and source files
		},
		fallback: {
			'path': require.resolve('path-browserify'),
			'http': require.resolve('stream-http'),
			'crypto': require.resolve('crypto-browserify'),
			'buffer': require.resolve('buffer/'),
			'https': require.resolve('https-browserify'),
			'url':require.resolve('url/'),
			'stream':require.resolve('stream-browserify'),
			'vm': require.resolve('vm-browserify'),
			// Webpack 5 no longer polyfills Node.js core modules automatically.
			// see https://webpack.js.org/configuration/resolve/#resolvefallback
			// for the list of Node.js core module polyfills.
			'assert': require.resolve('assert'),
			'fs':false,
			'zlib':require.resolve('browserify-zlib'),
			'net':false,
			'tls':false,

		}
	},
	module: {
		rules: [{
			test: /\.ts$/,
			exclude: /node_modules/,
			use: [{
				loader: 'ts-loader'
			}]
		}]
	},
	plugins: [
		 new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
        }),
		new webpack.ProvidePlugin({
			process: 'process/browser', // provide a shim for the global `process` variable
		}),
		new NodePolyfillPlugin(),

	],
	externals: {
		'vscode': 'commonjs vscode', // ignored because it doesn't exist
	},
	performance: {
		hints: false
	},
	devtool: 'nosources-source-map', // create a source map that points to the original source file
	infrastructureLogging: {
		level: "log", // enables logging required for problem matchers
	},
};

/** @type WebpackConfig */

const browerServerConfig = {
	mode:"none",
	target:"webworker", 
	entry: {
		'server': './server/src/browserServerMain.ts'
	},
	output: {
		filename: "[name].js",
		path: path.join(__dirname,'server','dist'),
		libraryTarget: 'var',
		library: 'serverExportVar'
	},
	resolve: {
		mainFields: ['browser','module', 'main'],
		extensions: ['.ts','.js'], // support ts-files and js-files
		alias: {},
		fallback: {
			//'child_process':false,
			'path': require.resolve("path-browserify"),
			'http': require.resolve('stream-http'),
			'crypto': require.resolve('crypto-browserify'),
			'buffer': require.resolve('buffer/'),
			'https': require.resolve('https-browserify'),
			'url':require.resolve('url/'),
			'stream':require.resolve('stream-browserify'),
			// Webpack 5 no longer polyfills Node.js core modules automatically.
			// see https://webpack.js.org/configuration/resolve/#resolvefallback
			// for the list of Node.js core module polyfills.
			'assert': require.resolve('assert'),
			'fs':false,
			'zlib':require.resolve('browserify-zlib'),
			'os': require.resolve('os-browserify/browser'),
			'net':false,
			'tls':false,
			'constants':false,
			'tty':false
		},
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
					},
				],
			},
		],
	},
	externals: {
		vscode: 'commonjs vscode', // ignored because it doesn't exist
	},
	performance: {
		hints: false,
	},
	devtool: 'source-map',
	plugins: [
		new webpack.ProvidePlugin({
		   Buffer: ['buffer', 'Buffer'],
	   }),
	   new webpack.ProvidePlugin({
		   process: 'process/browser', // provide a shim for the global `process` variable
	   }),
	   new NodePolyfillPlugin(),

   ],

}

module.exports =  [ browerClientConfig, browerServerConfig];