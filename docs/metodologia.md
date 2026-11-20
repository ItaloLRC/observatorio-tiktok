# Metodologia de análise

O painel usa a observação mais recente de cada vídeo ativo. Visualizações e interações são contagens acumuladas até a coleta. Campos ausentes ficam nulos. O contexto da coleta, como o final da lista ou uma interrupção, fica registrado separadamente.

O painel converte horários para `America/Sao_Paulo`. Quando a fonte fornece a data de publicação, ela tem preferência. A estimativa a partir do identificador do vídeo pode divergir da publicação efetiva. O campo `timestamp_source` indica a origem.

O notebook agrupa vídeos por dia da semana, faixa de duas horas, duração e hashtag. Ele calcula z-scores dentro de cada canal para comparar desempenho relativo e informa o tamanho dos grupos. Grupos com pouca observação ou concentração em poucos vídeos exigem cautela. A idade do vídeo e diferenças de conteúdo e audiência podem afetar os resultados.

A relação entre variáveis é descritiva. O laboratório usa correlação de Pearson e regressão linear na amostra selecionada. O [estudo de caso](https://github.com/ItaloLRC/observatorio-tiktok/blob/main/docs/estudo-de-caso.md) detalha os denominadores e as hipóteses analisadas.
