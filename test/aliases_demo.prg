// Demo file for the new fork features:
// - built-in DEFAULT command (harbour.aliases.customDefault, on by default,
//                              no settings/commandRules entry needed)
// - harbour.aliases.commandRules   (your own #command rules from settings.json,
//                                    no need to paste a #command line in every .prg)
// - harbour.aliases.callSuffixes   ("Exec" suffix aliases to the receiver)
// - hover showing the comment above a function
// - validate on save (uncomment the line with a typo to see a diagnostic)
//
// The extension always generates a .ch with the DEFAULT command (so "Default
// cNome := x" compiles as "Default(cNome, x)" below, cascades of any length
// via ",;" included) and passes it to the compiler via -u+
// automatically, on every validate/build. Set harbour.aliases.customDefault
// to false to turn this off. It also colors "Default" like a keyword in the
// editor, so harbour.aliases.customKeywords doesn't need a separate entry
// for it.

FUNCTION Main()
    LOCAL cNome      := ""
    LOCAL cSobreNome := "" ,;
        ba := "" ,;
        Ca := ""

    Default cNome := "mundo"
    default(cSobreNome, "bar")

    default cZZ := "abc" ,;
        ff := "dd"


    // Isso tem que dar erro porque não tem Local definido
    ZugZug := "asdf"

    ff  := "asdfa"


    dd = "asdf"

    Saudacao( cNome )

    // With harbour.aliases.callSuffixes = ["Exec"], typing inside
    // Saudacao:Exec( ) should show the same signature help as Saudacao( ).
    Saudacao:Exec( cNome )

    // Isso tem que dar erro porque não existe
    clientedeErro()

    // Uncomment to test validate-on-save (undeclared function):
    // ? FuncaoQueNaoExiste( cNome )

RETURN NIL

/* Retorna uma saudação formatada para o nome informado.
   Hover sobre "Saudacao" (aqui ou na chamada acima) deve mostrar
   este comentário. */
FUNCTION Saudacao( cNome )
RETURN "Ola, " + cNome + "!"

FUNCTION SemComentario()
RETURN NIL
// (SemComentario acima não tem comentário imediatamente antes dela
// -- este comentário está DEPOIS, então não conta. Hover sobre
// SemComentario deve ficar sem tooltip de comentário.)
