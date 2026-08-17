// Demo file for the new DocBlock (JSDoc/PHPDoc-style) hover support.
//
// How to test: hover the mouse over each function's NAME where it's
// CALLED, inside Main() below (not over the FUNCTION line itself).
//
// Three comment styles coexist in this file, each hovering differently:
//
// 1) Mens() -- the file's FIRST function (textually, below). Its
//    banner-style header comment is always shown as-is, verbatim, never
//    parsed as a DocBlock -- this is the rule some shops' custom
//    compilers require a fixed header format on the first function of
//    every file.
// 2) Saudacao() -- a free-form, unstructured comment. Still shown as-is
//    (plain text) -- nothing changes for comments that don't use "@tag"
//    syntax, anywhere in the file.
// 3) MensBonita() and Calcular() -- DocBlock-style comments ("@param",
//    "@return", "@example", ...). Hover renders these as a formatted card
//    (parameters list, return value, example block), same visual style
//    already used for hovering standard RTL functions like Len().
//
// Also try just placing the cursor inside "/**" above MensBonita/Calcular
// and looking at the syntax colors: "@param"/"@return"/etc. and the
// "<name>" placeholders should be highlighted distinctly from the rest of
// the comment (reuses the same color VS Code already uses for JSDoc tags).

*********************************************************************
**                                                                 **
**  Referencia: MENS                                                **
**                                                                 **
**  Objeto    : Mens:Exec()                                        **
**                                                                 **
**  Objetivo  : Mostra uma mensagem simples na tela, no padrao do  **
**                banner exigido pela primeira funcao do arquivo.  **
**                                                                 **
**  Exemplo   : Mens("Ola")                                        **
**                                                                 **
*********************************************************************
**                                                                 **
**  Criacao    : 17/08/2026 - Demo                                  **
**  Atualizacao:                                                    **
**                                                                 **
*********************************************************************
FUNCTION Mens(cMsg)
RETURN NIL

// Comentario livre, sem nenhuma tag "@algo" -- continua funcionando
// exatamente como sempre funcionou, mostrado como texto puro no hover.
FUNCTION Saudacao(cNome)
RETURN "Ola, " + cNome + "!"

/**
 * Mostra uma mensagem formatada na tela e registra no log.
 *
 * @param <cMsg>  Texto da mensagem a ser exibida.
 * @param <nTipo> Tipo da mensagem (1=Info, 2=Erro). Opcional, padrao 1.
 * @return .T. se a mensagem foi exibida com sucesso.
 * @example
 *   MensBonita("Processo concluido", 1)
 */
FUNCTION MensBonita(cMsg, nTipo)
RETURN .T.

/**
 * Soma dois valores numericos.
 *
 * @param <nA> Primeira parcela.
 * @param <nB> Segunda parcela.
 * @return A soma de <nA> e <nB>.
 */
FUNCTION Calcular(nA, nB)
RETURN nA + nB

FUNCTION Main()
    LOCAL cNome := "Mundo"

    Mens("Ola")
    Saudacao(cNome)
    MensBonita("Processo concluido", 1)
    Calcular(10, 20)

RETURN NIL
