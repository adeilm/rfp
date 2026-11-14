# TendOlive's Microsoft Teams bot (thin adapter: Teams <-> n8n "RFP - Chat"). Python 3.12, the base image of the RAG and the
# studio (its layers are shared). Without BOT_APP_ID / BOT_APP_PASSWORD / BOT_TENANT_ID it stays idle: /health answers, Teams is off.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt /tmp/bot-requirements.txt
RUN pip install -r /tmp/bot-requirements.txt && rm /tmp/bot-requirements.txt \
 && useradd --create-home --uid 10001 bot && mkdir -p /data && chown bot:bot /data
COPY bot/ /app/bot/
COPY tests/ /app/tests/
COPY scripts/ /app/scripts/
COPY pytest.ini /app/pytest.ini
USER bot
EXPOSE 3978
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3978/health', timeout=4).status == 200 else 1)"
CMD ["python", "-m", "bot.app"]
