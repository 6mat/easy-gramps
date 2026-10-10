FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV DATA_DIR=/data
# The app's own data (each person's settings): writable by the app's user, and a new volume mounted
# here starts with this owner too.
RUN mkdir -p /data && chown 1000:1000 /data
USER 1000:1000
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
