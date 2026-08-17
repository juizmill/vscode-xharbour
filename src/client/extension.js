const vscode = require('vscode');
const path = require('path');
const client = require('vscode-languageclient');
const fs = require("fs");
const validation = require('./validation.js');
const decorator = require('./decorator.js');
const docCreator = require('./docCreator.js');
const taskProvider = require('./taskProvider.js');
const net = require("net");
const formatEditor = require("./formatEditor.js");
const iconTheme = require("./iconTheme.js");

function activate(context) {
	vscode.languages.setLanguageConfiguration('harbour', {
		indentationRules: {
			increaseIndentPattern: /^\s*((?:(?:static|init|exit)\s+)?(?:proc(?:e(?:d(?:u(?:r(?:e)?)?)?)?)?|func(?:t(?:i(?:o(?:n)?)?)?)?)|class(?!\s*(?:var|data|method))|method|if|else(?:if)?|for|if|try|case|otherwise|(?:do\s+)?while|switch|begin)\b/i,
			decreaseIndentPattern: /^\s*(end\s*([a-z]*)?|next|else|elseif|return)\b/i,
			indentNextLinePattern: /;((?:\/\/|&&).*)?$/
		}
	});
	validation.activate(context);

	const serverModule = context.asAbsolutePath(path.join('dist','hb_server.js'));
	const debugOptions = { execArgv: ["--nolazy", "--inspect-brk=21780"] };
	const serverOptions = {
		run : { module: serverModule, transport: client.TransportKind.ipc },
		debug: { module: serverModule, transport: client.TransportKind.ipc , options: debugOptions }
	}
	const clientOptions = {
		documentSelector: ['harbour'],
		synchronize: {
			configurationSection: ['harbour','search','editor']
		}
	}
	const cl = new client.LanguageClient('HarbourServer', 'Harbour Server', serverOptions, clientOptions);
	cl.registerProposedFeatures()
	context.subscriptions.push(cl.start());
	vscode.commands.registerCommand('harbour.getDbgCode', () => { getDbgCode(context); })
	vscode.commands.registerCommand("harbour.debugList", DebugList)
	vscode.commands.registerCommand("harbour.setupCodeFormat", () => { formatEditor.showEditor(context); })
	decorator.activate(context,cl);
	docCreator.activate(context,cl);
	taskProvider.activate();
	iconTheme.activate(context);
	// https://code.visualstudio.com/updates/v1_30#:~:text=Finalized%20Debug%20Adapter%20Tracker%20API
	/*vscode.debug.registerDebugAdapterTrackerFactory('harbour-dbg', {
		createDebugAdapterTracker(  ) {
		  return {
			onWillReceiveMessage: m => console.log(`> ${m.seq} - C ${m.command} - ${m.arguments? JSON.stringify(m.arguments).substring(0,50) : "no-args"}`),
			onDidSendMessage: m => console.log(`< ${m.seq} - ${m.command ? "C" : "E"} ${m.command ? m.command : m.event} - ${m.body? JSON.stringify(m.body).substring(0,50) : 'no-body'}`)
		  };
		}
	  });*/
}

function DebugList(args) {
	return new Promise((resolve,reject) => {
		const picks = vscode.window.createQuickPick();
		picks.placeholder = "select the process to attach with"
		picks.busy=true;
		picks.items=[];
		const port = args.port? args.port :6110;
		const server = net.createServer(socket => {
			socket.on("data", data=> {
				try {
					while(true) {
						const lines = data.toString().split("\r\n");
						if(lines.length<2)  {//todo: check if they arrive in 2 tranches.
							break;
						}
						const clPath = path.basename(lines[0],path.extname(lines[0])).toLowerCase();
						var processId = parseInt(lines[1]);
						if(args.program && args.program.length>0) {
							const exeTarget = path.basename(args.program,path.extname(args.program)).toLowerCase();
							if(clPath!=exeTarget) break;
						}
						if(!picks.items.find((v)=>v.process==processId))
							picks.items=picks.items.concat([{label:clPath+":"+processId, process:processId }])
						break;
					}
				} catch(ex) { }
				socket.write("NO\r\n")
				socket.end();
			});
		}).listen(port);
		picks.onDidAccept(()=>{
			picks.hide();
		});
		picks.onDidHide(()=> {
			server.close();
			if(picks.selectedItems.length>0) {
				resolve(picks.selectedItems[0].process.toString());
			} else
				resolve("");
		})

		picks.show();;
	});
}

function getDbgCode(context) {
	fs.readFile(path.join(context.extensionPath,'extra','dbg_lib.prg'),(err,data) =>
    {
        if(!err)
			vscode.workspace.openTextDocument({
				content: data.toString(),
				language: 'harbour'}).then(doc => {
					vscode.window.showTextDocument(doc);
				})
    });
}

function deactivate() {
	 validation.deactivate();
}

exports.activate = activate;
exports.deactivate = deactivate;

