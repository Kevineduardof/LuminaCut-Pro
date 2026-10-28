# ✨ LuminaCut Pro — Removedor de Fundo IA em Ultra Resolução

O **LuminaCut Pro** é uma aplicação web de estúdio para remoção de fundo de imagens por Inteligência Artificial, projetada com foco em **zero perda de resolução** e **100% de privacidade** (processamento totalmente local no navegador via WebAssembly/WebGPU).

Diferente de ferramentas convencionais que comprimem ou redimensionam a imagem original durante a inferência neural, o LuminaCut Pro extrai a máscara de segmentação alfa em alta precisão e a recompõe diretamente sobre os **pixels RGB nativos** da imagem original.

---

## 🚀 Principais Funcionalidades

- **🎯 Motor True-RGB Alpha (Zero Perda de Qualidade):** Os canais RGB originais não passam por recompressão neural — cada detalhe, textura e resolução nativa (incluindo fotos 4K/8K) permanecem 100% intactos.
- **🔒 100% Local & Privado:** Todo o processamento de IA roda diretamente no navegador do usuário utilizando `@imgly/background-removal` (ONNX Runtime Web). Nenhuma imagem é enviada para servidores externos.
- **🧠 Seleção de Motor Neural:**
  - **IS-Net FP16:** Alta precisão com inferência mais rápida e menor uso de memória.
  - **IS-Net 32-bit:** Ultra precisão de estúdio para recortes complexos.
- **🎛️ Refinamento de Borda HD em Tempo Real (via LUT 256 níveis):**
  - **Ajuste de Contorno (Choke / Spread):** Contraia (`-50`) para remover halos residuais ou expanda (`+50`) o contorno da máscara.
  - **Nitidez de Transição Alfa:** Controle o contraste das bordas semitransparentes (`0%` a `100%`).
  - **Suavização de Borda (Feather):** Desfoque gaussiano/box rápido (`0px` a `8px`) no canal alfa para transições suaves.
  - **Descontaminação de Cor nas Bordas:** Algoritmo inteligente que neutraliza o reflexo colorido (*color bleed/halo*) do fundo antigo nas bordas semitransparentes.
- **🔍 Viewport Interativo de Estúdio:**
  - **4 Modos de Visualização:** Comparador *Antes / Depois* (Split Slider interativo), *Sem Fundo*, *Original* e *Inspeção de Máscara Alfa* (preto e branco de alto contraste).
  - **Zoom de Alta Precisão (50% a 800%) & Pan:** Navegue livremente pela imagem com renderização *pixel-perfect* (`pixelated` acima de 300%).
  - **Lupa de Inspeção 4× Calibrada:** Lente de aumento em tempo real sincronizada com a linha divisória do modo *Antes / Depois*.
- **🎨 Fundo de Estúdio Personalizável:** Visualize e exporte com fundo transparente (xadrez escuro/claro), fundo branco de estúdio, cores sólidas personalizadas ou gradientes.
- **💾 Exportação Lossless em Resolução Nativa:** Baixe o resultado final nas dimensões exatas da imagem de origem em **PNG (100% Lossless)** ou **WebP (Ultra HD)**, com opção de incluir ou não o fundo de estúdio.
- **⚡ Fluxo de Trabalho Ágil:** Suporte a *Drag & Drop* (arrastar e soltar), colagem direta da área de transferência (`Ctrl+V`) em qualquer lugar da tela e gerador integrado de **Imagem Demo Ultra-HD (1600×1200 px)** para testes imediatos mesmo offline.

---

## 🛠️ Tecnologias Utilizadas

- **[React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)** — Interface reativa e tipagem estática.
- **[Vite 6](https://vite.dev/)** — Bundler e servidor de desenvolvimento ultrarrápido.
- **[@imgly/background-removal](https://github.com/imgly/background-removal-js)** — Execução local dos modelos neurais IS-Net via ONNX Runtime Web (WASM / WebGPU).
- **[Tailwind CSS 3](https://tailwindcss.com/)** — Estilização moderna em tema escuro de estúdio.
- **[Lucide React](https://lucide.dev/)** — Ícones vetoriais limpos e consistentes.
- **HTML5 Canvas 2D API & TypedArrays (`Uint8Array`)** — Manipulação direta de buffers de imagem, Look-Up Tables (LUT) e filtragem espacial em milissegundos.

---

## 📂 Estrutura do Projeto

```text
LuminaCut Pro/
├── src/
│   ├── components/
│   │   └── ComparisonViewport.tsx  # Viewport interativo (Split Antes/Depois, Zoom 800%, Pan e Lupa 4x)
│   ├── utils/
│   │   └── imageProcessor.ts       # Pipeline IA, composição True-RGB, refinamento de bordas e exportação
│   ├── App.tsx                     # Interface principal, controles de estúdio e gerenciamento de estado
│   ├── index.css                   # Estilos globais, barras de rolagem e padrões de transparência
│   └── main.tsx                    # Ponto de entrada da aplicação React
├── index.html                      # Template HTML principal
├── package.json                    # Dependências e scripts NPM
├── tailwind.config.js              # Configuração do Tailwind CSS
├── tsconfig.json                   # Configuração do TypeScript
└── vite.config.ts                  # Configuração do Vite
```

---

## ⚙️ Como Executar Localmente

### Pré-requisitos

- **Node.js** (versão 18 ou superior recomendada)
- **npm** (ou `pnpm` / `yarn`)

### Passo a passo

1. **Instale as dependências do projeto:**
   ```bash
   npm install
   ```

2. **Inicie o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```

3. **Acesse no navegador:**
   Abra o endereço exibido no terminal (geralmente `http://localhost:5173`).

---

## 📦 Build para Produção

Para compilar o TypeScript e gerar os arquivos otimizados na pasta `dist/`:

```bash
npm run build
```

Para visualizar localmente a versão de produção gerada:

```bash
npm run preview
```

---

## 💡 Como Funciona o Pipeline "Zero Perda de Resolução"?

1. **Leitura Nativa (`loadImageFullRes`):** A imagem enviada é decodificada em um `HTMLCanvasElement` na sua resolução natural exata (`naturalWidth` × `naturalHeight`), preservando o buffer `ImageData` original intacto na memória.
2. **Extração da Máscara Alfa (`extractHighResAlphaMask`):** O modelo neural (`isnet_fp16` ou `isnet`) processa a segmentação do objeto e a máscara resultante é interpolada com suavização de alta qualidade para as dimensões exatas da foto original, extraindo um vetor `Uint8Array` puro apenas com o canal alfa.
3. **Refinamento e Descontaminação (`renderRefinedCutout`):**
   - O canal alfa passa opcionalmente por um filtro *box blur* separável 1D (`smoothAlphaChannel`) para *feathering*.
   - Uma **LUT (Look-Up Table) de 256 entradas** aplica instantaneamente os ajustes de *Edge Shift* (contrair/expandir) e *Edge Contrast*.
   - Nos pixels de borda semitransparentes (`8 < alpha < 230`), o algoritmo de **Descontaminação de Halo** amostra os pixels opacos vizinhos do primeiro plano para limpar invasões de cor do fundo original.
   - Por fim, os valores RGB originais (sem compressão) são combinados com o novo canal alfa refinado.

---

## 📄 Licença

Este projeto é de uso privado/educacional. Sinta-se à vontade para explorar, estudar e adaptar às suas necessidades!

