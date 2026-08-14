//@ts-check

'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const pjson = require('./package.json');

const distPath = path.resolve(__dirname, 'dist');

/** @type {import('webpack').Configuration} */
const clientConfig = {
  target: 'node',
  entry: {
    "extension": './src/client/extension.js',
    "debugger": './src/client/debugger.js'
  },
  output: {
    path: distPath,
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'source-map',
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.js'],
    alias: {
      '@yagisumi/win-output-debug-string': require.resolve('@yagisumi/win-output-debug-string/build/Release/win_output_debug_string.node')
    }
  },
  module: {
    rules: [
      {test: /\.node$/, use: 'node-loader'},
      {
        test: /\.js$/,
        exclude: /node_modules/
      }
    ]
  },
  node: {
    __dirname: false
  },
  plugins: [
    new CopyPlugin({patterns:[
      ...['codicon.css','codicon.ttf'].map(f => ({
        from: path.join(path.dirname(require.resolve('@vscode/codicons/package.json')), 'dist', f),
        to: 'codicons/' + f
      })),
      {
        from: path.resolve(__dirname, 'test', 'dbg_lib.prg'),
        to: path.resolve(__dirname, 'extra', 'dbg_lib.prg'),
        transform: content => `// For Harbour extension version v.${pjson.version}\r\n\r\n` + content
      }
    ]})
  ]
};

/** @type {import('webpack').Configuration} */
const serverConfig = {
  target: 'node',
  entry: './src/server/main.js',
  output: {
    path: distPath,
    filename: 'hb_server.js'
  },
  devtool: 'source-map',
  resolve: {
    extensions: ['.js']
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/
      }
    ]
  },
  node: {
    __dirname: false
  },
  plugins: [
    new CopyPlugin({patterns:[
      {from: "src/server/hbdocs.*", to:"[name][ext]"}
    ]})
  ]
};

module.exports = [clientConfig, serverConfig];
