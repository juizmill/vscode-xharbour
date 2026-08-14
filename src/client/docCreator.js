const vscode = require('vscode');

// reuse the bracket-match style
let decoration;
/** @type{client.LanguageClient} */
let client;

function activate(context,_client) {
	client=_client;
	vscode.window.onDidChangeTextEditorSelection((e) => WriteDoc(e) );
}

function WriteDoc(evt) {
    if(evt.kind!=1) return; //only keyboard
	const editor = evt.textEditor
	if(!editor) return;
	if(!editor.document) return;
    if(editor.document.languageId!="harbour") return;
    if( evt.selections.length>1 ||
        evt.selections[0].start.line!=evt.selections[0].end.line ||
        evt.selections[0].start.character!=evt.selections[0].end.character)
        return;
    const destRange = new vscode.Range(evt.selections[0].start.line,0,evt.selections[0].start.line,100);
    const line = editor.document.getText(destRange)
    if(!line.startsWith("/* $DOC$")) return;
    const param = {textDocument:{uri:editor.document.uri.toString()}, sel:destRange};
    param["eol"]=editor.document.eol;
    client.sendRequest("harbour/docSnippet",param).then(snippet=>{
        if(snippet) {
            evt.textEditor.insertSnippet(new vscode.SnippetString(snippet),destRange);
        }
    });
}

exports.activate = activate;
