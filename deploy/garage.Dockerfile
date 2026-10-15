# Garage with its config baked in, for deployments that cannot bind-mount a file from the
# repository (docker-compose.coolify.yml). Secrets come from the environment, never the image.
FROM dxflrs/garage:v2.4.1
COPY garage.toml /etc/garage.toml
