# Postgres 18 with pgvector (as docker-compose.yml) plus pgBackRest for encrypted, off-site,
# point-in-time backups to an S3-compatible bucket (ADR 0024). pgBackRest comes from the PGDG apt
# repository the official image already trusts.
FROM pgvector/pgvector:pg18
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates pgbackrest \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest /var/lib/pgbackrest /var/spool/pgbackrest /etc/pgbackrest
COPY entrypoint.sh /usr/local/bin/yayatoh-postgres-entrypoint.sh
RUN chmod 0755 /usr/local/bin/yayatoh-postgres-entrypoint.sh
ENTRYPOINT ["yayatoh-postgres-entrypoint.sh"]
CMD ["postgres"]
