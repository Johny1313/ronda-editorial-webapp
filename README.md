# Ronda Editorial 24h — Cloudflare

Aplicação para coleta editorial, agrupamento de assuntos, monitoramento dedicado de termos e geração de roteiro de carrossel com leitura de uma matéria por vez.

## Versão 2.8.0

A v2.8.0 fortalece a geração de carrosséis em três etapas: leitura obrigatória de uma matéria publicada, redação ancorada em evidências e validação final de coerência. Frases incompletas, trechos concatenados e tabelas de percentuais sem contexto são rejeitados antes de o roteiro ser liberado.

A evolução de estilo passa a ser persistente por perfil. O sistema **não se treina automaticamente com o próprio texto gerado**: isso reforçaria erros. Em vez disso, o usuário pode revisar/editar um roteiro e clicar em **Aprovar e ensinar estilo**. Até 24 carrosséis aprovados alimentam uma memória compacta de padrões de escrita (comprimento, ritmo e estrutura), sem reutilizar fatos, nomes ou números antigos.

Para ativar a memória editorial após o deploy, aplique as migrations do banco principal:

```powershell
npx --yes wrangler@4.113.0 d1 migrations apply DB --remote
```

## Controle de armazenamento D1

A política de armazenamento iniciada na versão 2.6.1 corrige o erro `D1_ERROR: Exceeded maximum DB size`. A causa era o acúmulo de payloads JSON completos da Ronda e, principalmente, do YouTube, incluindo descrições, tags e vídeos repetidos dentro de assuntos e canais.

Política atual:

- o D1 principal (`DB`) guarda a Ronda, termos, leitura inteligente e perfis;
- o YouTube usa o D1 separado `YOUTUBE_DB`;
- somente as 12 rondas mais recentes mantêm o payload JSON completo; o histórico operacional preserva até 576 linhas leves;
- o YouTube mantém até 12 snapshots e 12 resultados recentes de termos no banco próprio;
- caches de leitura, carrossel e tradução têm limites máximos além do TTL;
- antes de uma nova gravação da Ronda, snapshots redundantes são liberados;
- ao detectar limite de armazenamento, o sistema limpa e repete a gravação uma única vez.

A interface continua exibindo a última coleta válida e não armazena imagens no D1; apenas as URLs das miniaturas são mantidas.

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

O módulo YouTube usa uma terceira fila e nunca bloqueia a Ronda:

```text
Cron a cada 15 minutos ou botão Atualizar YouTube
        ↓
ronda-editorial-youtube-jobs
        ↓
videos.list mostPopular (Brasil)
        ↓
um termo ativo por rotação, quando houver cota
        ↓
estatísticas, agrupamento e decisão editorial local
        ↓
YOUTUBE_DB / aba YouTube
```

O banco `YOUTUBE_DB` é isolado do `DB`; uma falha ou crescimento do YouTube não impede a gravação de novas rondas.

A aba não possui gráficos. Ela preserva o padrão de cards, chips, filtros, indicadores e links de apuração usado pela Ronda.

A leitura inteligente usa uma fila separada e exige apuração em uma página publicada:

```text
assunto selecionado
        ↓
ronda-editorial-intelligent-jobs
        ↓
tenta até 3 portais do assunto
        ↓
abre e extrai o texto principal de 1 matéria publicada
        ↓
extrai evidências diretamente do texto
        ↓
Workers AI apenas redige com essas evidências
        ↓
roteiro de 3 a 15 slides em português
```

Se nenhum portal puder ser aberto e lido, o carrossel não é gerado. Feed, título e resumo nunca substituem a matéria publicada.

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
- Queue independente do YouTube;
- Dead Letter Queue para as três filas;
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

A aplicação possui migrações versionadas até `0004_youtube_integration.sql`. O deploy do Worker não executa migrations automaticamente. Para aplicar todas as migrações pendentes pelo terminal:

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
| `/api/youtube/status` | GET | Estado, quota e circuito do módulo YouTube |
| `/api/youtube/latest` | GET | Última coleta, assuntos, vídeos, canais, alertas e termos |
| `/api/youtube/collect` | POST | Enfileira atualização manual do YouTube |
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
src/                      Worker, módulos de negócio e coletor YouTube
test/                     testes automatizados
CHANGELOG.md               histórico consolidado
package.json               scripts e versão oficial
package-lock.json          instalação determinística sem dependências locais
schema.sql                 referência consolidada do banco
wrangler.jsonc             infraestrutura e deploy
```

## Configuração do YouTube

A integração exige uma chave da YouTube Data API v3 protegida como secret do Worker:

```bash
npx --yes wrangler@4.113.0 secret put YOUTUBE_API_KEY
```

No painel Cloudflare, a mesma configuração pode ser feita em **Settings → Variables and Secrets**, criando um secret chamado `YOUTUBE_API_KEY`. Nunca grave a chave no GitHub, no HTML ou em `wrangler.jsonc`.

O `wrangler.jsonc` declara automaticamente a Queue `ronda-editorial-youtube-jobs` e sua Dead Letter Queue. O módulo usa região `BR`, até 25 vídeos por coleta, cache persistente e circuit breaker após falhas consecutivas. Os termos cadastrados na Ronda são reutilizados em rotação; não existe um segundo cadastro.

## Limitações reais

Portais externos podem alterar feeds, bloquear automação ou limitar requisições. O sistema reduz o impacto com rotas alternativas, backoff e snapshots, mas não garante leitura completa de páginas protegidas por paywall ou sistemas antirobô. Em qualquer roteiro, os links originais permanecem disponíveis para revisão editorial.

## Ajuste YouTube 2.7.3

A coleta YouTube usa a categoria `News & Politics` como primeiro filtro e, em seguida, valida o canal por identidade jornalística. A comparação não depende mais de igualdade literal do nome do canal: aliases conhecidos e marcadores fortes de redação são aceitos. Se uma amostra atual não trouxer nenhum canal aprovado, o último snapshot jornalístico válido permanece disponível em cache em vez de ser substituído por uma coleção vazia.


## Mesa de pauta (v2.8.0)
A aba Mesa mantém pautas persistentes, mostra o que mudou, organiza workflow e passagem de turno.

## Curadoria do YouTube
Cadastre até 30 canais jornalísticos por @handle, URL ou ID. Com canais ativos, a coleta monitora os uploads deles; sem curadoria, usa o radar jornalístico padrão.
