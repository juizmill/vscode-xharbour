// Demo file for the new fork features:
// - harbour.aliases.commandRules   (defines the DEFAULT command from settings.json,
//                                    no need to paste a #command line in every .prg)
// - harbour.aliases.callSuffixes   ("Exec" suffix aliases to the receiver)
// - hover showing the comment above a function
// - validate on save (uncomment the line with a typo to see a diagnostic)
//
// harbour.aliases.commandRules (see test/.vscode/settings.json) generates a
// .ch with "#command DEFAULT <v> := <x> => Default( <v>, <x> )" and passes
// it to the compiler via -u+ automatically, on every validate/build. That's
// what makes "Default cNome := x" actually compile as "Default(cNome, x)"
// below -- and it also colors "Default" like a keyword in the editor, so
// harbour.aliases.customKeywords doesn't need a separate entry for it.

FUNCTION Main()
    LOCAL cNome := ""

    Default cNome := "mundo"
    default cZZ := "abc"

    // Isso tem que dar erro porque não tem Local definido
    ZugZug := "asdf"

    ff  := "asdfa"


    dd = "asdf"

    ? Saudacao( cNome )

    // With harbour.aliases.callSuffixes = ["Exec"], typing inside
    // Saudacao:Exec( ) should show the same signature help as Saudacao( ).
    ? Saudacao:Exec( cNome )

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
