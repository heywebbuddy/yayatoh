Synthetic, self-signed test certificates (public halves only; their keys were thrown away):
`synthetic-sns-cert.pem` has the subject `CN=sns.amazonaws.com` like Amazon SNS's signing
certificates, `synthetic-other-cert.pem` has another subject. They are made up for the SNS
certificate checks in `providers.test.ts` and are not Amazon's.
