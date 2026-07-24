# Ronda Editorial 24h — Webapp Cloudflare

Webapp com coleta online, painel responsivo, botão de ronda manual, agendamento a cada cinco minutos e histórico de 48 horas.

**Versão 2.1.2:** a Leitura Inteligente abre até cinco matérias do assunto, extrai o conteúdo principal por HTML/JSON-LD e tenta a versão AMP quando indicada. O processamento pesado foi movido para uma Cloudflare Queue, evitando a interrupção causada pelo limite de tarefas HTTP em segundo plano. O painel acompanha o progresso pelo D1; quando um portal bloqueia a leitura, o sistema usa o texto, resumo ou título armazenado pelo feed. A IA possui tempo limite e sempre há um roteiro de contingência com sete slides.

## Versão GitHub recomendada

Este pacote está preparado para **Cloudflare Workers Builds com GitHub**. Consulte primeiro `PUBLICAR-COM-GITHUB.txt`. Antes do deploy, crie uma Queue chamada `ronda-editorial-intelligent-jobs`. O D1, o Workers AI, o produtor e o consumidor da Queue e o Cron Trigger são declarados no `wrangler.jsonc`.

## O que funciona

- Ronda automática mesmo com o navegador fechado.
- Ronda manual pelo painel.
- Ronda manual iniciada em segundo plano, com acompanhamento de progresso no painel.
- Interface e Worker usam a mesma versão sem cache antigo; respostas antigas e novas são tratadas sem quebrar o painel.
- 30 portais identificados individualmente, divididos em Brasil e Mundo.
- Brasil: G1, CNN Brasil, Folha de S.Paulo, Estadão, O Globo, Veja, Poder360, Agência Brasil, Nexo Jornal, InfoMoney, Money Times, ge, Canaltech, TecMundo, O Liberal, Metrópoles e Campo Grande News.
- Mundo: BBC News, The Guardian, CNN, The New York Times, The Washington Post, Al Jazeera, France 24, Deutsche Welle, El País, Euronews, CBC News, ABC News Australia e Infobae.
- Títulos, descrições e o conteúdo usado pelo roteiro das fontes do Mundo permanecem em português antes do agrupamento e do armazenamento no histórico.
- Cache de traduções no D1: conteúdos repetidos não consomem uma nova tradução a cada ronda.
- Proteção de idioma: se uma tradução falhar, o conteúdo afetado é omitido em vez de aparecer em inglês ou espanhol.
- Rota alternativa por Google News quando o feed principal falha, respeitando um orçamento seguro de consultas externas do Worker.
- Bluesky como complemento social; uma falha do Bluesky não interrompe os portais.
- Agrupamento de títulos semelhantes em assuntos.
- Classificação automática por editoria: Notícias, Política, Esportes, Entretenimento, Economia, Mundo, Tecnologia e Saúde.
- Filtro clicável por editoria e identificação visível em cada assunto.
- Prévia editorial de carrossel em sete slides na coleta.
- Botão **Gerar roteiro de carrossel** abre simultaneamente até cinco matérias de fontes distintas.
- Extração do conteúdo principal por JSON-LD, `<article>`, `<main>` e blocos editoriais; menus, anúncios, widgets e textos repetidos são removidos.
- Quando a página indica uma versão AMP e a leitura principal é insuficiente, o Worker tenta a versão AMP.
- Cada portal possui tempo limite independente. Falhas 403/429/503, paywall, HTML insuficiente ou timeout não derrubam o roteiro.
- Em caso de bloqueio, a análise usa automaticamente o texto, resumo ou título que o feed já forneceu durante a ronda.
- O processamento é gravado no D1 e enviado à Cloudflare Queue como tarefa com estados `queued`, `running`, `succeeded` e `failed`; o consumidor possui tempo suficiente para leitura de portais e análise da IA.
- O painel acompanha o progresso, reutiliza uma tarefa já em execução e oferece **Tentar novamente** quando necessário.
- Cada item preserva até 2.400 caracteres do conteúdo recebido na ronda, mantendo uma base de contingência segura.
- O painel informa quantas matérias foram lidas diretamente, quantas usaram fallback e a qualidade do material.
- Respostas estruturadas para: o que aconteceu, quem está envolvido, onde, quando, impacto e repercussão.
- Extração de personagens, empresas, locais, datas, temas e palavras-chave.
- Carrossel Instagram com exatamente sete slides: título principal, contexto, informação principal, detalhamento, consequência, conclusão e CTA; cada slide possui título e subtítulo.
- Resultado armazenado no D1 por 48 horas para evitar reprocessar o mesmo assunto.
- Carrosséis gerados exclusivamente em português e identificados como `pt-BR`.
- Aviso obrigatório de revisão editorial e links das matérias originais para conferência.
- Toda notícia captada conserva obrigatoriamente sua URL original de apuração.
- Cards, conteúdos relacionados e histórico exibem um botão individual **Abrir para apuração**.
- O carrossel mostra todos os links das notícias usadas; o roteiro copiado também inclui título, portal e URL de cada apuração.
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

O binding `AI` definido no `wrangler.jsonc` é usado tanto para traduzir fontes internacionais quanto para estruturar o roteiro. A tradução usa `@cf/meta/m2m100-1.2b`; a leitura inteligente usa por padrão `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, podendo ser alterada pela variável `ARTICLE_ANALYSIS_MODEL`. Se a IA exceder o tempo limite, retornar JSON inválido ou falhar, o sistema conclui a tarefa com um roteiro de contingência. Para desativar temporariamente a leitura direta e trabalhar apenas com os feeds, defina `ARTICLE_LIVE_READING=0`.

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

`npm run smoke` executa o Worker compilado no emulador oficial, simula portais e Bluesky, grava a ronda no D1 e confirma dashboard, tarefa assíncrona, leitura direta das matérias, fallback, sete slides, cache, histórico e saúde.

Rotas principais:

| Rota | Método | Função |
| --- | --- | --- |
| `/` | GET | Dashboard |
| `/api/health` | GET | Servidor, banco e última coleta |
| `/api/self-test` | GET | Parser, agrupamento, card e leitura/escrita D1 |
| `/api/latest` | GET | Última ronda válida |
| `/api/history` | GET | Histórico das últimas 48 horas |
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
