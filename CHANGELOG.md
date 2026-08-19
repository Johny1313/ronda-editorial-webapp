# Ronda Editorial v2.8.5

## Carrossel — origem verificada e conclusão resiliente
- corrige a regressão iniciada quando a geração passou a exigir que o Worker baixasse novamente o HTML da página;
- mantém como primeira opção a leitura direta da matéria publicada;
- quando a página bloqueia o Worker, aceita conteúdo suficiente vindo do feed **próprio do portal**, desde que a coleta tenha ocorrido pela rota direta do veículo, a URL seja do publicador, o texto não esteja truncado e haja aderência à manchete;
- conteúdo de agregadores e Google News continua proibido como base factual do carrossel;
- descrições do feed próprio só são aceitas quando amplas (>=120 palavras); conteúdo integral do feed próprio pode ser aceito a partir de 90 palavras;
- amplia com segurança a busca de matérias relacionadas na mesma ronda sem misturar assuntos;
- se a IA falhar, o roteiro determinístico baseado nas evidências continua e encerra o ciclo;
- o cache do carrossel foi invalidado para não reaproveitar resultados da lógica anterior.

## Validação
- 82 testes automatizados aprovados;
- cenários extras de estresse: 50 gerações válidas concluídas e 10 casos de agregador corretamente bloqueados;
- `npm run check` aprovado;
- validação de release aprovada.

# Ronda Editorial v2.8.3

## Conclusão resiliente do carrossel

- Seleciona a fonte legível com maior capacidade factual entre as alternativas do assunto.
- Se a matéria não sustentar a quantidade solicitada sem repetição, reduz automaticamente os slides em vez de abortar.
- Mantém a exigência de leitura real do portal e nunca completa fatos ausentes.
- Informa na interface quando a quantidade foi ajustada e por quê.
- Cache de geração invalidado pela nova versão do prompt/evidências.

- Reorganiza o modal do carrossel para priorizar o resultado: header e controles → cards dos slides → informações editoriais → apuração e evidências.
- Elimina o scroll longo antes do roteiro e reposiciona automaticamente o modal no topo após a geração.
- Mantém perfil de escrita, quantidade de slides e botão Gerar novamente no cabeçalho operacional.
- Preserva todo o conteúdo de apuração, rastreabilidade, análise, entidades e fontes abaixo dos cards.

# Ronda Editorial v2.8.1

- Remove os chips individuais de veículos da home da Ronda e substitui por um resumo compacto, não clicável.
- Mantém a seleção por veículo exclusivamente na aba Fontes.
- Adiciona botão **Mostrar tudo** na Ronda para limpar busca, período, tipo, região, editoria e fonte selecionada.
- O filtro por fonte passa a exibir **Mostrar todas as fontes** com destaque.
- Ao voltar para a Ronda pelo menu, uma seleção de veículo não permanece presa.
- Nomes de fontes dentro dos cards deixam de funcionar como filtros acidentais.

# 2.8.0 — Mesa de pauta, passagem de turno e curadoria YouTube

- Pautas persistentes entre rondas e detecção de mudanças.
- Filas: Pautar agora, Subindo, Acompanhar e Sem novidade.
- Workflow, responsável, notas, seguir pauta e passagem de turno.
- Verificação: fonte única, 2+ fontes e fonte oficial.
- Curadoria de até 30 canais do YouTube por @handle, URL ou channel ID.
- Com curadoria ativa, a coleta usa a playlist de uploads dos canais escolhidos.

## 2.7.8 — carrossel coerente + memória editorial aprovada

- Corrige frases truncadas, colagens de percentuais e blocos de tabela sem contexto durante a extração da matéria.
- Adiciona validação obrigatória de completude gramatical por slide e uma segunda revisão de coerência somente quando necessária.
- Mantém cada número, nome, data e afirmação ancorados na matéria de portal efetivamente lida.
- Tabelas/placares extraídos sem contexto semântico são descartados em vez de virar frases incompletas.
- Todo roteiro passa a ter conclusão editorial; em carrosséis de 3 e 4 slides, a conclusão tem prioridade sobre CTA.
- Nova memória editorial persistente por usuário: somente carrosséis explicitamente aprovados/ajustados entram como exemplos.
- A memória aprende padrões de forma (ritmo, extensão, uso de perguntas e dois-pontos), nunca fatos de matérias anteriores.
- Novo botão **Aprovar e ensinar estilo** no modal do carrossel.
- Cache do carrossel é invalidado quando a memória editorial do usuário evolui.
- Nova migration `0008_carousel_editorial_learning.sql`.

## 2.7.6 — carrossel baseado obrigatoriamente em matéria publicada

- O carrossel só é gerado depois de abrir e extrair o texto principal de pelo menos um portal que publicou a matéria.
- Feed, resumo, título e descrição não substituem mais a leitura do site.
- Até três fontes do mesmo assunto podem ser tentadas para encontrar uma matéria legível; apenas uma matéria lida é usada no roteiro.
- A IA não cria fatos: fatos/evidências são extraídos deterministicamente do texto da matéria; Workers AI atua somente na redação dos slides.
- Cada slide é validado contra as evidências e números existentes na matéria. Conteúdo não sustentado volta para uma redação determinística baseada no texto fonte.
- Se nenhum portal puder ser lido, a geração termina com diagnóstico explícito em vez de produzir carrossel por contingência.
- Cache só é aceito quando contém texto principal previamente extraído de uma página de portal verificada.
- Erro de matéria indisponível não entra em loop de retry da Queue, reduzindo espera desnecessária.

# Changelog

## 2.7.5 — carrossel rápido e conclusão garantida

- Reduz de duas chamadas sequenciais de Workers AI para uma única geração estruturada de fatos + roteiro.
- Timeout da leitura direta reduzido e fallback imediato para o conteúdo da própria matéria.
- Caminho rápido quando o feed já contém texto amplo, evitando download redundante do portal.
- Timeout da IA limitado; se exceder, o roteiro é finalizado automaticamente pelo modo factual de contingência.
- Menos gravações de progresso no D1 e fila de leitura com concorrência 3.
- Polling do navegador limitado a 75 segundos e jobs sem progresso expiram em 2 minutos.
- Logs `intelligent_job_completed` registram duração total, leitura, IA, fast-path e número de slides.
- Mantém perfil editorial, quantidade flexível de slides e apuração baseada em uma única matéria.

## 2.7.4 — resiliência e diagnóstico da Ronda

- Preserva a última ronda válida quando uma nova tentativa falha.
- Mantém os diagnósticos reais dos portais em tentativas encerradas após retries.
- Diferencia coleta `complete`, `partial` e `failed`.
- Coleta parcial continua sendo publicada quando há dados úteis, mesmo se parte do processamento complementar falhar.
- `/api/status` informa a última tentativa com resumo de fontes, cache, degradação e falhas.
- `/api/runs/:id` expõe diagnóstico compacto sem devolver o payload editorial completo.
- O painel mostra a última tentativa problemática sem substituir os dados válidos por zeros.
- Chips de fontes passam a representar a tentativa mais recente enquanto os cards preservam a última ronda válida.
- Logs finais incluem totais de fontes com conteúdo, degradadas e falhas por código.

## 2.7.3 — correção da busca YouTube somente notícias

- Corrige regressão que zerava resultados por comparação exata do nome do canal.
- `mostPopular` passa a solicitar explicitamente a categoria News & Politics.
- Busca por termos também usa a categoria News & Politics.
- Identificação de veículos aceita aliases seguros e canais jornalísticos com marcadores fortes.
- Mantém bloqueio de creators genéricos, games, react e canais de cortes.
- Quando a amostra atual não contém nenhum canal jornalístico aprovado, preserva o último snapshot válido em cache em vez de substituir a aba por zero resultados.
- Preserva `categoryId` ao enriquecer resultados de `search.list` com estatísticas.

## 2.7.3 — YouTube somente em canais de notícias

- Aba YouTube restrita a uma lista fixa de veículos jornalísticos.
- Canais de creators, entretenimento e comentários independentes são descartados da coleta.
- Vídeos populares são filtrados antes de agrupamento, ranking e alertas.
- Buscas dos Termos também retornam apenas vídeos de canais jornalísticos aprovados.
- A API pública filtra snapshots antigos para impedir que canais não jornalísticos reapareçam após o deploy.
- A coleta de `mostPopular` lê até 50 candidatos em uma única chamada e mantém apenas os canais aprovados, sem aumentar o número de chamadas desse endpoint.

## 2.7.1 — recuperação do D1 e isolamento do YouTube

- Corrige a falha `D1_ERROR: Exceeded maximum DB size` na gravação da Ronda.
- Move novas coletas do YouTube para o binding D1 separado `YOUTUBE_DB`.
- Remove snapshots antigos do YouTube do banco editorial principal durante a recuperação.
- Mantém payload completo somente nas 12 rondas mais recentes; histórico mais antigo permanece como metadados leves.
- Limita caches de leitura, carrosséis, jobs e traduções por quantidade, além do TTL.
- Executa uma limpeza leve antes de gravar uma nova ronda.
- Falha do banco do YouTube não derruba `/api/health` nem a Ronda de portais.
- Inclui `migrations/0007_core_storage_rescue_and_youtube_split.sql` e `migrations_youtube/0001_youtube_database.sql`.

## 2.7.0 — perfis editoriais e carrosséis flexíveis

- Cadastro e login por e-mail e senha com PBKDF2 e sessões `HttpOnly`.
- Nova aba Perfil, mantendo a linguagem visual da Ronda.
- Biblioteca de até 8 textos/posts, limitada a 5.000 caracteres por exemplo e 30.000 por perfil.
- Análise de tom, ritmo, títulos, subtítulos, estrutura, vocabulário e CTA com fallback heurístico.
- O estilo não altera a apuração: o roteiro continua baseado em uma única matéria e no mapa de fatos validado.
- Quantidade de carrossel configurável de 3 a 15 slides, mantendo 7 como padrão.
- Preferência padrão salva por usuário e seletor disponível em cada geração.
- Cache separado por quantidade de slides e versão do perfil de escrita.
- Limpeza periódica de sessões expiradas.
- Migração `0006_user_profiles_and_flexible_carousels.sql`.
- Corrige duplicação acidental de fontes vencidas no pool da ronda e torna o cache temporal determinístico.

## 2.6.1 — controle de armazenamento D1

- Corrige `D1_ERROR: Exceeded maximum DB size`.
- Limita snapshots do YouTube a 48 coletas e resultados de termos a 24 registros.
- Mantém no máximo 288 rondas finalizadas no banco principal.
- Compacta vídeos, assuntos e canais antes da gravação, removendo descrições, tags e duplicações desnecessárias.
- Executa limpeza emergencial e repete a gravação uma única vez quando o D1 atinge o limite.
- Reduz o cache de traduções para 14 dias e a retenção normal de rondas para 24 horas.
- Inclui migração `0005_d1_storage_guard.sql`.

## 2.6.0 — YouTube integrado e isolado da Ronda

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
