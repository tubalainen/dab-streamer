FROM nginx:alpine
RUN apk add --no-cache curl
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY public/ /usr/share/nginx/html/
EXPOSE 80
