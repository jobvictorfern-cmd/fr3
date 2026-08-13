# Editor FR3

Editor visual de relatorios **FastReport (.fr3)** que roda no navegador, sem
build e sem dependencias. Abre o arquivo, mostra a pagina com as bandas e os
objetos como no designer do FastReport, permite editar e devolve um `.fr3` que
continua abrindo no Delphi/FastReport original.

O editor tambem le arquivos com outras extensoes que carregam o mesmo XML
(`.term`, `.xml`) — e o caso dos tickets exportados pelo sistema de pesagem.

## Como executar

```bash
npm start        # sobe um servidor estatico em http://localhost:5173
```

Qualquer servidor estatico serve (`python3 -m http.server`, nginx, Live Server
do VS Code). Nao abra o `index.html` direto pelo `file://`: o editor usa
modulos ES e `fetch`, que o navegador bloqueia nesse esquema.

Ao abrir, o relatorio de exemplo em `samples/rsiamac_1.fr3` e carregado. Para
trabalhar em outro arquivo, use **Abrir** ou arraste o `.fr3` para a janela.

## O que da para fazer

**Layout**
- Pagina renderizada em escala real (mm), com margens, grade, reguas e zoom.
- Bandas com legenda, selecao e alca para mudar a altura (as bandas seguintes
  sao empurradas junto).
- Objetos: mover arrastando, redimensionar pelas 8 alcas, selecao multipla por
  clique com Shift/Ctrl ou por laco, arrastar de uma banda para outra
  (a posicao absoluta na pagina e preservada).
- Alinhamento e igualar tamanho entre varios objetos.
- Duplicar, excluir, ordem de desenho (frente/tras), copiar e colar.
- Desfazer/refazer de tudo.

**Objetos suportados**
- `TfrxMemoView` (texto, com expressoes `[campo]`), `TfrxLineView`,
  `TfrxShapeView`, `TfrxPictureView` (imagem embutida em `Picture.PropData`) e
  `TfrxBarCodeView`. Tipos desconhecidos aparecem como um retangulo com o nome
  da classe — e continuam intactos no arquivo salvo.
- Edicao de texto no proprio objeto (duplo clique).
- Troca da imagem de um `TfrxPictureView`: o arquivo escolhido e convertido em
  BMP 24 bits e regravado no formato de stream do Delphi (`TBitmap`), que
  qualquer versao do FastReport consegue abrir.

**Propriedades**
- Painel contextual por tipo: posicao/tamanho, fonte, alinhamento, quebra,
  formato de exibicao, dataset/campo, moldura, preenchimento, forma, imagem.
- Propriedades da pagina: tamanho do papel (com predefinicoes, inclusive bobina
  de 58/80 mm), margens, girar papel.
- Variaveis do relatorio: criar, renomear e remover.

**Pre-visualizacao (F5)**
- Empilha as bandas na ordem de impressao, prende o rodape na base da folha e
  substitui as expressoes pelos valores de teste informados na aba **Dados**.
- Expressoes sem valor ficam destacadas.
- Botao **Imprimir / PDF** usa a impressao do navegador (a folha ja sai no
  tamanho certo).

## Atalhos

| Atalho | Acao |
| --- | --- |
| `Ctrl+O` / `Ctrl+S` | Abrir / salvar |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Ctrl+C` / `Ctrl+V` | Copiar / colar objetos |
| `Ctrl+D` | Duplicar |
| `Ctrl+A` | Selecionar tudo na banda |
| `Delete` | Excluir selecao |
| Setas | Mover 1 mm (`Shift` = 10 mm, `Alt` = 1 px) |
| Duplo clique | Editar o texto do objeto |
| `Shift` ao arrastar | Trava o movimento em um eixo |
| `Alt` ao arrastar | Ignora o ajuste a grade |
| `F5` / `Esc` | Abrir / fechar a pre-visualizacao |

## Fidelidade do arquivo

Um `.fr3` e um XML gerado pelo Delphi, com ordem de atributos, entidades
numericas (`&#13;&#10;`) e indentacao proprias. O editor **nao** reescreve o
arquivo: ele preserva o texto original de tudo que voce nao editou e so
regrava os atributos alterados.

Na pratica: abrir e salvar sem mexer em nada devolve um arquivo **byte a byte
identico** ao original (ha teste automatizado para isso), e mover um objeto
altera exatamente uma linha do diff. Propriedades que o editor nao conhece —
scripts, estilos, `Highlight`, sub-relatorios — atravessam o ciclo intactas.

## Estrutura do projeto

```
index.html            layout da aplicacao
styles/app.css        tema da interface
src/core/xml.js       parser/serializador XML que preserva o texto original
src/core/fr3.js       modelo do relatorio (paginas, bandas, objetos, variaveis)
src/core/units.js     mm/px, TColor (BGR), fonte Delphi, bits de moldura
src/core/picture.js   leitura/escrita da imagem embutida (Picture.PropData)
src/core/render.js    desenho dos objetos em DOM (editor e pre-visualizacao)
src/ui/store.js       estado, selecao e historico de desfazer
src/ui/canvas.js      area de edicao e interacoes de mouse
src/ui/tree.js        arvore da estrutura
src/ui/inspector.js   painel de propriedades
src/ui/datapanel.js   variaveis, datasets e valores de teste
src/ui/preview.js     pre-visualizacao/impressao
scripts/serve.js      servidor estatico de desenvolvimento
test/fr3.test.js      testes (node --test)
```

O nucleo (`src/core`) nao depende do DOM para ler e gravar o arquivo, entao
serve tambem para scripts em Node — por exemplo, para alterar relatorios em
lote.

## Testes

```bash
npm test
```

Cobrem round-trip byte a byte do relatorio real, codificacao de entidades,
leitura da estrutura, geometria da pagina, insercao/duplicacao/remocao de
objetos, redimensionamento de banda, movimentacao entre bandas, variaveis,
conversao de cores e fontes e a imagem embutida.

## Limitacoes conhecidas

- Nao ha interpretador de PascalScript nem conexao com banco: a
  pre-visualizacao usa os valores de teste informados na aba **Dados**, e a
  banda de dados e desenhada uma vez (nao repete linhas).
- Quebra automatica de pagina nao e simulada: a pre-visualizacao mostra uma
  folha, mesmo que o conteudo passe do fim dela.
- Objetos de tipos mais raros (grafico, rich text, sub-relatorio) sao exibidos
  como um retangulo identificado; suas propriedades especificas so podem ser
  ajustadas no designer original — mas nao se perdem ao salvar.
- O texto e desenhado com as fontes disponiveis no navegador; pode haver
  pequena diferenca de quebra em relacao a impressao do FastReport.
