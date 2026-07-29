# Changelog

## 2.6.1 — controle de armazenamento D1

- Corrige `D1_ERROR: Exceeded maximum DB size`.
- Limita snapshots do YouTube a 48 coletas e resultados de termos a 24 registros.
- Mantém no máximo 288 rondas finalizadas no banco principal.
- Compacta vídeos, assuntos e canais antes da gravação, removendo descrições, tags e duplicações desnecessárias.
- Executa limpeza emergencial e repete a gravação uma única vez quando o D1 atinge o limite.
- Reduz o cache de traduções para 14 dias e a retenção normal de rondas para 24 horas.
- Inclui migração `0005_d1_storage_guard.sql`.

## 2.6.1 — YouTube integrado e isolado da Ronda

- Nova aba YouTube com a mesma UX da Ronda e sem gráficos.
- Indicadores de vídeos, assuntos, canais e decisões editoriais.
- Cards de assuntos, lista de vídeos, ranking de canais, alertas e resultados dos termos.
- Coleta independente na Queue `ronda-editorial-youtube-jobs`.
- Vídeos em alta do Brasil a cada 15 minutos.
- Um termo ativo da Ronda por rotação de 30 minutos, respeitando reserva de cota.
- Chave protegida no secret `YOUTUBE_API_KEY`.
- Persistência no D1, cache, quota, retry, circuit breaker e Dead Letter Queue.
- Endpoints `/api/youtube/status`, `/api/youtube/latest` e `/api/youtube/collect`.
- Migração `0004_youtube_integration.sql`.
- Falhas do YouTube não alteram o status nem a velocidade da Ronda de portais.

## 2.5.2 — correção do estado da ronda e resposta mais rápida

- Estado `queued` antes da Queue e `running` somente no consumidor.
- `completed_at` não recebe mais horário falso na abertura.
- Heartbeat e expiração automática de rondas sem progresso.
- Snapshots antigos filtrados pelo catálogo atual de 39 portais.
- Tradução inicial limitada a 18 títulos novos, com timeout menor.
- Painel diferencia ronda na fila, em andamento, expirada e falha.
- Migração `0003_round_state_machine.sql`.


## 2.5.1 — remoção dos canais de curiosidades

- Remoção de Fatos Desconhecidos, Mega Curioso, Incrível.club, Mistérios do Mundo, Canaltech Curiosidades, Superinteressante, Revista Galileu, Segredos do Mundo e Awebic.
- Hypeness permanece fora do catálogo.
- Catálogo reduzido de 48 para 39 portais: 26 do Brasil e 13 do Mundo.
- Remoção das consultas agregadas e individuais usadas exclusivamente pelos canais de curiosidades.
- Diagnósticos ativos limitados ao catálogo atual.
- Migração para limpar estados persistidos das fontes removidas.

## 2.5.0 — processamento otimizado e diagnóstico persistente

- Coleta escalonada em 5, 15 e 30 minutos.
- Pool máximo de cinco conexões externas.
- Rondas manuais e automáticas processadas em Queue.
- Snapshot persistente por portal com ETag, Last-Modified e backoff.
- Recuperação por fonte por até 72 horas.
- Diagnóstico exato de 403, 404, 429, timeout, feed inválido e ausência de novas matérias.
- Static Assets separados do Worker.
- Polling adaptativo e ETag em `/api/status` e `/api/latest`.
- Migração D1 versionada e manutenção periódica.
- Menos gravações de progresso e renovação de locks.
- Retries classificados e Dead Letter Queue.
- Logs estruturados, traces, minificação e preview por branch.
- Cadastro manual de sites permanece removido.
- Tradução internacional mantém baixa concorrência, cache e prioridade por portal.

## 2.4.4

- Remoção do cadastro manual de sites.
- Estabilização da tradução internacional.

## 2.4.3

- Remoção e correção de portais inativos ou com domínio alterado.

## 2.4.2

- Correções na apuração, seleção de URL e leitura de matéria.

## 2.4.0–2.4.1

- Coleta ampliada de portais e leitura inteligente baseada em uma matéria.

## Versões anteriores

- Evolução do painel, termos dedicados, classificação editorial, histórico e integração com Cloudflare.
