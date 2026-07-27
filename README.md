# Ronda Editorial 24h — Webapp Cloudflare

Webapp com coleta online, painel responsivo, botão de ronda manual, agendamento a cada cinco minutos e histórico de 48 horas.

**Versão 2.4.3:** atualiza o catálogo de fontes sem alterar o layout compacto. Hypeness e Contigo! foram removidos da ronda; Mistérios do Mundo passou para `misteriosdomundo.org`; Observatório dos Famosos passou a usar a seção atual do JC/UOL; Incrível.club e Observatório dos Famosos usam consultas dedicadas; Mistérios do Mundo recebe feed direto no domínio novo; e Awebic permanece em contingência compartilhada para respeitar o limite seguro de requisições. Somente itens das últimas 24 horas entram na ronda. Fontes acessíveis sem publicação recente passam a aparecer como **sem novas**, em vez de **falhou**.

## Versão GitHub recomendada

Este pacote está preparado para **Cloudflare Workers Builds com GitHub**. Consulte primeiro `PUBLICAR-COM-GITHUB.txt`. Antes do deploy, crie uma Queue chamada `ronda-editorial-intelligent-jobs`. O D1, o Workers AI, o produtor e o consumidor da Queue e o Cron Trigger são declarados no `wrangler.jsonc`.

## O que funciona

- Ronda automática mesmo com o navegador fechado.
- Aba **Sites** para cadastrar, pausar, reativar e remover até oito fontes próprias.
- URLs comuns usam busca por domínio no Google Notícias; URLs RSS/Atom são consultadas diretamente com fallback.
- As rotas agregadas são compartilhadas entre portais para permanecer dentro do limite seguro de consultas externas do Worker.
- Se uma fonte falhar temporariamente, a ronda pode reutilizar somente itens da última coleta válida que ainda estejam dentro das 24 horas, marcados como `cache`.
- O painel usa os estados `dir` (direto), `fb` (fallback), `cache`, `sem novas` e `falhou`.
- Aba **Termos** para cadastrar até seis nomes, marcas ou assuntos de acompanhamento exclusivo.
- Notícias encontradas por termos são armazenadas em `dedicatedMonitoring` e nunca entram nos itens ou assuntos da Ronda principal.
- Termos pausados ou removidos deixam de ser buscados e seus resultados ficam ocultos.
- Sites e termos ficam persistidos no D1 e são usados tanto em rondas manuais quanto automáticas.
- Ronda manual pelo painel.
- Ronda manual iniciada em segundo plano, com acompanhamento de progresso no painel.
- Interface e Worker usam a mesma versão sem cache antigo; respostas antigas e novas são tratadas sem quebrar o painel.
- 48 portais identificados individualmente, divididos em Brasil e Mundo.
- Brasil — notícias gerais: G1, CNN Brasil, Folha de S.Paulo, Estadão, O Globo, Veja, Poder360, Agência Brasil, Nexo Jornal, InfoMoney, Money Times, ge, Canaltech, TecMundo, O Liberal, Metrópoles e Campo Grande News.
- Brasil — celebridades e televisão: UOL Splash, LeoDias, Quem, Caras Brasil, TV Foco, Purepeople Brasil, Observatório dos Famosos, Área VIP e NaTelinha.
- Brasil — curiosidades e ciência pop: Fatos Desconhecidos, Mega Curioso, Incrível.club, Mistérios do Mundo, Canaltech Curiosidades, Superinteressante, Revista Galileu, Segredos do Mundo e Awebic.
- Mundo: BBC News, The Guardian, CNN, The New York Times, The Washington Post, Al Jazeera, France 24, Deutsche Welle, El País, Euronews, CBC News, ABC News Australia e Infobae.
- Títulos, descrições e o conteúdo usado pelo roteiro das fontes do Mundo permanecem em português antes do agrupamento e do armazenamento no histórico.
- Cache de traduções no D1: conteúdos repetidos não consomem uma nova tradução a cada ronda.
- Proteção de idioma: se uma tradução falhar, o conteúdo afetado é omitido em vez de aparecer em inglês ou espanhol.
- Rota alternativa por Google News quando o feed principal falha, respeitando um orçamento seguro de consultas externas do Worker. Fontes de publicação irregular podem pesquisar até sete dias no Google Notícias para diagnóstico, mas somente itens das últimas 24 horas entram na ronda; ausência de publicação recente não é tratada como indisponibilidade.
- Bluesky como complemento social; uma falha do Bluesky não interrompe os portais.
- Agrupamento de títulos semelhantes em assuntos.
- Classificação automática por editoria: Notícias, Política, Esportes, Entretenimento, Fofoca e Celebridades, Reality Shows, Curiosidades e Ciência Pop, Conteúdo Viral e Redes Sociais, Luto e Obituário, Segurança e Justiça, Economia, Mundo, Tecnologia e Saúde.
- Filtro clicável por editoria e identificação visível em cada assunto. Regras de precedência impedem que morte, falecimento, homicídio ou acidente fatal sejam enviados para entretenimento.
- Prévia editorial de carrossel em sete slides na coleta.
- Botão **Gerar roteiro de carrossel** seleciona uma única matéria entre as fontes do assunto.
- Seleção orientada por qualidade, relevância, atualidade e taxa histórica de sucesso do portal.
- Cache do texto principal por 12 horas: uma regeneração não precisa abrir novamente a mesma matéria.
- Extração do conteúdo principal por JSON-LD, `<article>`, `<main>` e blocos editoriais; menus, anúncios, widgets e textos repetidos são removidos.
- Quando a página indica uma versão AMP e a leitura principal é insuficiente, o Worker tenta a versão AMP.
- A única matéria selecionada possui tempo limite independente. Falhas 403/429/503, paywall, HTML insuficiente ou timeout não derrubam o roteiro.
- Durante uma leitura demorada, a tarefa grava avanços intermediários entre 18% e 60%, evitando a impressão de processamento travado.
- URLs diretas do publisher com conteúdo utilizável têm prioridade sobre links de agregadores; quando um redirecionamento chega à matéria original, o link final é preferido na apuração.
- O fallback é estritamente da mesma matéria selecionada: nenhum outro portal é aberto ou usado para completar o roteiro.
- Em caso de bloqueio, a análise usa automaticamente o texto, resumo ou título que o feed já forneceu durante a ronda.
- O processamento é gravado no D1 e enviado à Cloudflare Queue como tarefa com estados `queued`, `running`, `succeeded` e `failed`; o consumidor possui tempo suficiente para leitura de portais e análise da IA.
- O painel acompanha o progresso, reutiliza uma tarefa já em execução e oferece **Tentar novamente** quando necessário.
- Ao terminar, o job assume obrigatoriamente `succeeded` ou `failed`, remove seu lock e informa `released: true` e `nextCycleAllowed: true`.
- **Tentar novamente** cria um job novo após um ciclo concluído, sem reaproveitar o identificador terminal anterior.
- Cada item preserva até 2.400 caracteres do conteúdo recebido na ronda, mantendo uma base de contingência segura.
- O painel informa qual matéria foi selecionada, se houve fallback e a qualidade do material.
- Respostas estruturadas para: o que aconteceu, quem está envolvido, onde, quando, impacto e repercussão.
- Mapa de fatos com trecho de evidência e nível de confiança antes da redação dos slides.
- Extração de personagens, empresas, locais, datas, temas e palavras-chave.
- Carrossel Instagram com exatamente sete slides: título principal, contexto, informação principal, detalhamento, consequência, conclusão e CTA; títulos possuem até 68 caracteres e subtítulos até 190.
- Validação automática de números sem suporte, evidências inválidas e slides repetidos.
- Conteúdo baseado somente em título é bloqueado; a cópia só é liberada para leitura ampla e roteiro validado.
- Títulos e subtítulos podem ser editados no painel com contador de caracteres.
- Resultado armazenado no D1 por 48 horas para evitar reprocessar o mesmo assunto.
- Carrosséis gerados exclusivamente em português e identificados como `pt-BR`.
- Aviso obrigatório de revisão editorial e links das matérias originais para conferência.
- Toda notícia captada conserva obrigatoriamente sua URL original de apuração.
- Cards, conteúdos relacionados e histórico exibem um botão individual **Abrir para apuração**.
- O carrossel identifica a única matéria utilizada e mantém os demais links do assunto apenas para apuração manual; o roteiro copiado inclui título, portal e URL de cada link.
- Cards com título, data, fontes, links para apuração e recomendação editorial.
- Tela Fontes agrupada em Brasil, Mundo e complemento social, com o estado de cada portal e filtro clicável por veículo.
- Chips superiores clicáveis: cada portal filtra imediatamente somente o conteúdo recolhido dele; fontes sem coleta ficam desativadas.
- Filtro de região com as opções Todas regiões, Brasil e Mundo.
- Leitura correta de RSS em UTF-8, ISO-8859-1 e Windows-1252.
- Histórico de rondas automáticas e manuais.
- Histórico clicável com todas as notícias, fontes, horários e links armazenados em cada ronda.
- Banco D1 criado automaticamente na primeira requisição.
- Trava contra rondas simultâneas e limite de uma execução manual por minuto.
- Chave opcional para proteger o botão Executar ronda.
- Diagnóstico em `/api/health` e autoteste em `/api/self-test`.

## Limite real das fontes

O código e a infraestrutura são verificáveis, mas fontes externas podem mudar endereços ou bloquear consultas. Por isso a coleta aceita falhas parciais, registra a situação de cada fonte e utiliza fallbacks. Sem APIs oficiais ou comerciais, esta versão não monitora integralmente Instagram, TikTok ou X.

O binding `AI` definido no `wrangler.jsonc` é usado tanto para traduzir fontes internacionais quanto para estruturar o roteiro. A tradução usa `@cf/meta/m2m100-1.2b`; a leitura inteligente usa por padrão `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, podendo ser alterada pela variável `ARTICLE_ANALYSIS_MODEL`. A geração ocorre em duas fases: apuração estruturada e redação baseada no mapa de fatos validado. Se a IA exceder o tempo limite, retornar JSON inválido ou falhar, o sistema conclui a tarefa com um roteiro de contingência quando houver conteúdo suficiente. Para desativar temporariamente a leitura direta e trabalhar apenas com os feeds, defina `ARTICLE_LIVE_READING=0`.

## Alternativa sem GitHub

Para esta versão, use GitHub + Workers Builds. O código depende do produtor e do consumidor de Queue declarados no `wrangler.jsonc`; colar somente o bundle em **Edit code** não é o fluxo recomendado para configurar toda a infraestrutura.

## Verificação obrigatória depois da publicação

Abra estes endereços substituindo `SEU-WORKER` pelo endereço publicado:

```text
https://SEU-WORKER.workers.dev/api/self-test
https://SEU-WORKER.workers.dev/api/health
```

Resultados esperados:

- `/api/self-test`: `"ok": true`, dois itens, um assunto agrupado e `"readWriteDelete": true`. O teste também confirma escrita, leitura e exclusão no D1.
- `/api/health`: `"ready": true`, `"database": "connected"`, `"translation":{"ready":true}`, `"queueReady":true` e `"executionMode":"cloudflare-queue"`.

Depois, clique em **Executar ronda**. Alguns feeds podem aparecer como `falhou`, mas a ronda será válida quando pelo menos um portal fornecer conteúdo recente. O indicador ficará verde após uma coleta concluída.

## Publicação local com Wrangler

Para desenvolvedores com Node.js 20 ou superior:

```bash
npm install
npx wrangler login
npx wrangler queues create ronda-editorial-intelligent-jobs
npm test
npm run deploy
npx wrangler secret put MANUAL_ROUND_TOKEN
```

O Wrangler provisiona automaticamente o D1 desta versão. O `wrangler.jsonc` também contém o Cron Trigger de cinco minutos.

## Desenvolvimento local

```bash
npm install
npm test
npm run smoke
npm run dev
```

`npm run smoke` executa o Worker compilado no emulador oficial, cadastra um site e o termo “Vini Jr”, simula portais, Google Notícias e Bluesky, confirma o isolamento dos resultados dedicados, testa a tarefa assíncrona, a leitura direta, sete slides, cache, histórico e saúde.

Rotas principais:

| Rota | Método | Função |
| --- | --- | --- |
| `/` | GET | Dashboard |
| `/api/health` | GET | Servidor, banco e última coleta |
| `/api/self-test` | GET | Parser, agrupamento, card e leitura/escrita D1 |
| `/api/latest` | GET | Última ronda válida |
| `/api/history` | GET | Histórico das últimas 48 horas |
| `/api/custom-sources` | GET/POST | Lista ou cadastra sites persistentes |
| `/api/custom-sources/:id` | PATCH/DELETE | Ativa, pausa ou remove um site |
| `/api/monitoring-terms` | GET/POST | Lista ou cadastra termos dedicados |
| `/api/monitoring-terms/:id` | PATCH/DELETE | Ativa, pausa ou remove um termo |
| `/api/runs/:id` | GET | Acompanha uma ronda manual em andamento |
| `/api/runs/:id/data` | GET | Recupera as notícias armazenadas em uma ronda histórica |
| `/api/round` | POST | Executa uma ronda manual |
| `/api/topics/:topicId/intelligent-carousel` | POST | Recupera o cache ou inicia a tarefa assíncrona de leitura e roteiro |
| `/api/intelligent-jobs/:jobId` | GET | Acompanha progresso, falha ou resultado da leitura inteligente |

## Arquivos

- `dist/cloudflare-worker-unico.js`: arquivo pronto para colar no dashboard.
- `src/`: backend modular do Worker.
- `public/`: interface editável.
- `test/`: testes automatizados.
- `schema.sql`: referência do banco; a aplicação também cria o esquema automaticamente.
