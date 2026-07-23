# Ronda Editorial 24h — Webapp Cloudflare

Webapp com coleta online, painel responsivo, botão de ronda manual, agendamento a cada cinco minutos e histórico de 48 horas.

**Versão 1.9.1:** botão “Ver roteiro do carrossel” ampliado para 44 px de altura, com fonte maior e adaptação responsiva para telas menores.

## Versão GitHub recomendada

Este pacote está preparado para **Cloudflare Workers Builds com GitHub**. Consulte primeiro `PUBLICAR-COM-GITHUB.txt`. O banco D1 usa provisionamento automático no primeiro deploy e o Cron Trigger já está definido no `wrangler.jsonc`.

## O que funciona

- Ronda automática mesmo com o navegador fechado.
- Ronda manual pelo painel.
- Ronda manual iniciada em segundo plano, com acompanhamento de progresso no painel.
- Interface e Worker usam a mesma versão sem cache antigo; respostas antigas e novas são tratadas sem quebrar o painel.
- 29 portais identificados individualmente, divididos em Brasil e Mundo.
- Brasil: G1, CNN Brasil, Folha de S.Paulo, Estadão, O Globo, Veja, Poder360, Agência Brasil, Nexo Jornal, InfoMoney, Money Times, ge, TecMundo, O Liberal, Metrópoles e Campo Grande News.
- Mundo: BBC News, The Guardian, CNN, The New York Times, The Washington Post, Al Jazeera, France 24, Deutsche Welle, El País, Euronews, CBC News, ABC News Australia e Infobae.
- Títulos e descrições das fontes do Mundo traduzidos para português pelo Workers AI antes do agrupamento e do armazenamento no histórico.
- Cache de traduções no D1: conteúdos repetidos não consomem uma nova tradução a cada ronda.
- Proteção de idioma: se uma tradução falhar, o conteúdo afetado é omitido em vez de aparecer em inglês ou espanhol.
- Rota alternativa por Google News quando o feed principal falha, respeitando um orçamento seguro de consultas externas do Worker.
- Bluesky como complemento social; uma falha do Bluesky não interrompe os portais.
- Agrupamento de títulos semelhantes em assuntos.
- Classificação automática por editoria: Notícias, Política, Esportes, Entretenimento, Economia, Mundo, Tecnologia e Saúde.
- Filtro clicável por editoria e identificação visível em cada assunto.
- Roteiro automático de carrossel em cinco cards, com tom de voz, modelo de post, sugestões de imagens e botão para copiar.
- Carrosséis gerados exclusivamente a partir do conteúdo em português e identificados como `pt-BR`.
- O roteiro usa somente títulos, descrições e indicadores da ronda e exibe aviso obrigatório de revisão editorial.
- Toda notícia captada conserva obrigatoriamente sua URL original de apuração.
- Cards, conteúdos relacionados e histórico exibem um botão individual **Abrir para apuração**.
- O carrossel mostra todos os links das notícias usadas; o roteiro copiado também inclui título, portal, URL de cada apuração e sugestões visuais com buscas em acervos CC0/domínio público.
- As sugestões de imagens são geradas a partir dos títulos das matérias e incluem links filtrados para Openverse e Wikimedia Commons; a licença deve ser confirmada na página do arquivo.
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

A tradução internacional usa o binding `AI` definido no `wrangler.jsonc` e o modelo `@cf/meta/m2m100-1.2b`. O Cloudflare aplica a franquia e os limites da conta. Se o limite de tradução estiver indisponível, o portal continua registrado, mas notícias não traduzidas não são exibidas.

## Alternativa sem GitHub — editor do Worker

Não use o Direct Upload do Pages. Como alternativa ao GitHub, crie primeiro um Worker Hello World, abra **Edit code** e substitua o código pelo conteúdo de `dist/cloudflare-worker-unico.js`.

1. Acesse **Workers & Pages** no Cloudflare.
2. Crie um Worker chamado `ronda-editorial-webapp`.
3. Abra o editor do Worker e substitua o código pelo conteúdo de `dist/cloudflare-worker-unico.js`.
4. Salve e publique.
5. Acesse **Storage & Databases → D1 SQL Database**.
6. Crie o banco `ronda-editorial-db`.
7. Volte ao Worker e abra **Settings → Bindings**.
8. Adicione um binding D1:
   - Nome da variável: `DB`
   - Banco: `ronda-editorial-db`
9. Ainda em **Settings → Bindings**, adicione um binding **Workers AI**:
   - Nome da variável: `AI`
10. Em **Settings → Triggers → Cron Triggers**, adicione:

   ```text
   */5 * * * *
   ```

11. Recomendado: em **Settings → Variables and Secrets**, adicione um Secret:
    - Nome: `MANUAL_ROUND_TOKEN`
    - Valor: uma chave escolhida por você
12. Abra novamente o endereço público do Worker.
13. Se configurou uma chave, abra **Ajustes** no painel e informe a mesma chave.

O Worker cria as tabelas automaticamente. Não é necessário executar `schema.sql` pelo painel.

## Verificação obrigatória depois da publicação

Abra estes endereços substituindo `SEU-WORKER` pelo endereço publicado:

```text
https://SEU-WORKER.workers.dev/api/self-test
https://SEU-WORKER.workers.dev/api/health
```

Resultados esperados:

- `/api/self-test`: `"ok": true`, dois itens, um assunto agrupado e `"readWriteDelete": true`. O teste também confirma escrita, leitura e exclusão no D1.
- `/api/health`: `"ready": true`, `"database": "connected"` e `"translation":{"ready":true}`.

Depois, clique em **Executar ronda**. Alguns feeds podem aparecer como `falhou`, mas a ronda será válida quando pelo menos um portal fornecer conteúdo recente. O indicador ficará verde após uma coleta concluída.

## Publicação local com Wrangler

Para desenvolvedores com Node.js 20 ou superior:

```bash
npm install
npx wrangler login
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

`npm run smoke` executa o Worker compilado no emulador oficial, simula portais e Bluesky, grava a ronda no D1 e confirma dashboard, autoteste, última ronda, histórico e saúde.

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

## Arquivos

- `dist/cloudflare-worker-unico.js`: arquivo pronto para colar no dashboard.
- `src/`: backend modular do Worker.
- `public/`: interface editável.
- `test/`: testes automatizados.
- `schema.sql`: referência do banco; a aplicação também cria o esquema automaticamente.
