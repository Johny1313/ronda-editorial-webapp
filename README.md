# Ronda Editorial 24h — Cloudflare

Aplicação para coleta editorial, agrupamento de assuntos, monitoramento dedicado de termos e geração de roteiro de carrossel com leitura de uma matéria por vez.

## Versão 2.5.2

A versão 2.5.2 corrige o ciclo da Queue, expira rondas presas e mantém o catálogo fixo de 39 portais sem canais dedicados a curiosidades.

Principais mudanças:

- catálogo fixo de 39 portais validados, sem cadastro manual de sites e sem canais dedicados a curiosidades;
- fontes divididas em frequências de 5, 15 e 30 minutos;
- no máximo cinco coletas externas simultâneas;
- ronda manual e automática processadas pela Queue `ronda-editorial-round-jobs`;
- snapshot persistente, ETag, `Last-Modified`, backoff e diagnóstico por portal;
- recuperação por fonte por até 72 horas, identificada como cache;
- interface servida como Static Assets, separada do Worker;
- endpoint leve `/api/status` e polling adaptativo no navegador;
- migração D1 versionada e limpeza periódica, sem manutenção pesada a cada ronda;
- retries classificados e Dead Letter Queue para rondas e leitura inteligente;
- build validado, Worker minificado e preview para branches não produtivas.


### Correção do processamento de rondas

- o botão e o Cron registram a ronda como `queued`;
- o estado muda para `running` somente quando o consumidor inicia;
- heartbeat é renovado entre coleta, persistência e tradução;
- jobs sem progresso expiram em até 10 minutos;
- snapshots antigos são filtrados pelo catálogo atual antes de chegar ao painel;
- a primeira etapa de tradução foi limitada a 18 títulos novos por ronda.

### Fontes removidas na 2.5.1

- Fatos Desconhecidos;
- Mega Curioso;
- Hypeness;
- Incrível.club;
- Mistérios do Mundo;
- Canaltech Curiosidades;
- Superinteressante;
- Revista Galileu;
- Segredos do Mundo;
- Awebic.

O portal Hypeness já não fazia parte da versão 2.5.0. Os outros nove canais foram removidos do catálogo, das rotas de fallback e dos diagnósticos ativos. A editoria “Curiosidades e Ciência Pop” permanece disponível apenas para classificar matérias desse tema publicadas pelos portais jornalísticos gerais.

## Arquitetura

```text
Cron ou botão Executar ronda
        ↓
ronda-editorial-round-jobs
        ↓
seleção das fontes vencidas
        ↓
pool máximo de 5 conexões
        ↓
RSS / rota alternativa / ETag / snapshot persistente
        ↓
tradução somente de títulos internacionais novos
        ↓
agregação, classificação e gravação da ronda
        ↓
/api/status informa novo runId
        ↓
navegador baixa /api/latest somente quando necessário
```

A leitura inteligente usa uma fila separada:

```text
assunto selecionado
        ↓
ronda-editorial-intelligent-jobs
        ↓
leitura de uma única matéria
        ↓
mapa de fatos e evidências
        ↓
roteiro de sete slides em português
```

## Frequência das fontes

- **Alta prioridade:** 12 portais, a cada 5 minutos.
- **Prioridade média:** 20 portais, a cada 15 minutos.
- **Publicação irregular:** 7 portais, a cada 30 minutos.

Depois que o estado das fontes estiver preenchido, uma janela média de cinco minutos verifica aproximadamente 20 das 39 fontes, em vez de consultar todas em cada execução.

## Estados de captação

Os chips continuam compactos e passam a distinguir:

- `dir`: coleta direta;
- `alt`: rota alternativa;
- `304`: fonte saudável, sem alteração no feed;
- `cache`: snapshot persistente reutilizado;
- `sem novas`: fonte acessível sem publicação recente;
- `HTTP 403`, `HTTP 429`, `timeout`, `404` ou `feed inválido`: diagnóstico real da falha.

Detalhes completos ficam disponíveis em:

```text
GET /api/sources/diagnostics
```

## Infraestrutura declarada

O `wrangler.jsonc` declara:

- Worker `ronda-editorial-webapp`;
- Static Assets em `public/`;
- D1 no binding `DB`;
- Workers AI no binding `AI`;
- Queue de leitura inteligente;
- Queue de rondas;
- Dead Letter Queue para ambas;
- Cron a cada cinco minutos;
- logs estruturados e traces;
- minificação antes do upload.

Com o provisionamento automático do Wrangler atual, recursos sem ID podem ser criados e vinculados no primeiro deploy. Em um projeto já existente, confira no painel se o binding `DB` está ligado ao banco usado pelas versões anteriores antes de promover a versão para produção.

## Publicação recomendada

Consulte `PUBLICAR-COM-GITHUB.txt`.

Configuração do Cloudflare Workers Builds:

```text
Build command: npm ci && npm run check
Deploy command: npx --yes wrangler@4.113.0 deploy
Preview command: npx --yes wrangler@4.113.0 versions upload
Production branch: main
```

Branches diferentes de `main` geram preview sem promover automaticamente a versão para produção. Por padrão, uma versão de preview do mesmo Worker usa os mesmos bindings; portanto, trate o preview como leitura e validação visual. Para testes que gravem dados, configure um Worker de staging com D1 e Queues separados.

## Migração do D1

A aplicação possui migrações versionadas até `0003_round_state_machine.sql`. O deploy do Worker não executa migrations automaticamente. Para aplicar todas as migrações pendentes pelo terminal:

```bash
npx --yes wrangler@4.113.0 d1 migrations apply DB --remote
```

O Worker mantém uma proteção de compatibilidade que cria as estruturas ausentes na primeira execução. A migração explícita continua recomendada porque registra a versão, consolida os estados `queued`, `running` e `expired`, remove índices antigos não utilizados e apaga do estado operacional os canais retirados do catálogo.

## Desenvolvimento e validação

Requer Node.js 20 ou superior; o projeto fixa Node 22 em `.nvmrc`.

```bash
npm ci
npm test
npm run build
npm run dev
```

Validação completa antes de publicar:

```bash
npm run check
```

Dry run do bundle Cloudflare:

```bash
npm run deploy:dry
```

## Rotas principais

| Rota | Método | Função |
| --- | --- | --- |
| `/api/status` | GET | Estado mínimo para polling do painel |
| `/api/health` | GET | Saúde da infraestrutura e última ronda |
| `/api/self-test` | GET | Parser, agrupamento e acesso ao D1 |
| `/api/latest` | GET | Última ronda válida, com ETag |
| `/api/history` | GET | Histórico das últimas 48 horas |
| `/api/sources/diagnostics` | GET | Diagnóstico persistente de cada fonte |
| `/api/monitoring-terms` | GET/POST | Termos dedicados |
| `/api/round` | POST | Enfileira ronda manual |
| `/api/runs/:id` | GET | Acompanha uma ronda |
| `/api/topics/:topicId/intelligent-carousel` | POST | Inicia ou recupera roteiro inteligente |
| `/api/intelligent-jobs/:jobId` | GET | Acompanha leitura inteligente |

## Estrutura do repositório

```text
.github/workflows/ci.yml   testes no GitHub
migrations/               migrações D1
public/                   HTML, CSS e JavaScript estáticos
scripts/                  validação da release
src/                      Worker e módulos de negócio
test/                     testes automatizados
CHANGELOG.md               histórico consolidado
package.json               scripts e versão oficial
package-lock.json          instalação determinística sem dependências locais
schema.sql                 referência consolidada do banco
wrangler.jsonc             infraestrutura e deploy
```

## Limitações reais

Portais externos podem alterar feeds, bloquear automação ou limitar requisições. O sistema reduz o impacto com rotas alternativas, backoff e snapshots, mas não garante leitura completa de páginas protegidas por paywall ou sistemas antirobô. Em qualquer roteiro, os links originais permanecem disponíveis para revisão editorial.
