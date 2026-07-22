# Ronda Editorial 24h — Webapp Cloudflare

Webapp com coleta online, painel responsivo, botão de ronda manual, agendamento a cada cinco minutos e histórico de 48 horas.

## Versão GitHub recomendada

Este pacote está preparado para **Cloudflare Workers Builds com GitHub**. Consulte primeiro `PUBLICAR-COM-GITHUB.txt`. O banco D1 usa provisionamento automático no primeiro deploy e o Cron Trigger já está definido no `wrangler.jsonc`.

## O que funciona

- Ronda automática mesmo com o navegador fechado.
- Ronda manual pelo painel.
- Ronda manual iniciada em segundo plano, com acompanhamento de progresso no painel.
- G1, Folha de S.Paulo, UOL, Estadão, Agência Brasil, BBC News Brasil e ronda geral.
- Rota alternativa para cada portal quando o feed principal falha.
- Bluesky como complemento social; uma falha do Bluesky não interrompe os portais.
- Agrupamento de títulos semelhantes em assuntos.
- Cards com título, data, fontes, links para apuração e recomendação editorial.
- Tela Fontes com o estado de cada portal e filtro clicável por veículo.
- Leitura correta de RSS em UTF-8, ISO-8859-1 e Windows-1252.
- Histórico de rondas automáticas e manuais.
- Banco D1 criado automaticamente na primeira requisição.
- Trava contra rondas simultâneas e limite de uma execução manual por minuto.
- Chave opcional para proteger o botão Executar ronda.
- Diagnóstico em `/api/health` e autoteste em `/api/self-test`.

## Limite real das fontes

O código e a infraestrutura são verificáveis, mas fontes externas podem mudar endereços ou bloquear consultas. Por isso a coleta aceita falhas parciais, registra a situação de cada fonte e utiliza fallbacks. Sem APIs oficiais ou comerciais, esta versão não monitora integralmente Instagram, TikTok ou X.

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
9. Em **Settings → Triggers → Cron Triggers**, adicione:

   ```text
   */5 * * * *
   ```

10. Recomendado: em **Settings → Variables and Secrets**, adicione um Secret:
    - Nome: `MANUAL_ROUND_TOKEN`
    - Valor: uma chave escolhida por você
11. Abra novamente o endereço público do Worker.
12. Se configurou uma chave, abra **Ajustes** no painel e informe a mesma chave.

O Worker cria as tabelas automaticamente. Não é necessário executar `schema.sql` pelo painel.

## Verificação obrigatória depois da publicação

Abra estes endereços substituindo `SEU-WORKER` pelo endereço publicado:

```text
https://SEU-WORKER.workers.dev/api/self-test
https://SEU-WORKER.workers.dev/api/health
```

Resultados esperados:

- `/api/self-test`: `"ok": true`, dois itens, um assunto agrupado e `"readWriteDelete": true`. O teste também confirma escrita, leitura e exclusão no D1.
- `/api/health`: `"ready": true` e `"database": "connected"`.

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
| `/api/round` | POST | Executa uma ronda manual |

## Arquivos

- `dist/cloudflare-worker-unico.js`: arquivo pronto para colar no dashboard.
- `src/`: backend modular do Worker.
- `public/`: interface editável.
- `test/`: testes automatizados.
- `schema.sql`: referência do banco; a aplicação também cria o esquema automaticamente.
