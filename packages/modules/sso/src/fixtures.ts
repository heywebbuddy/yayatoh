/**
 * Recorded fake IdP material (M6.5a): public certificates only (no private keys exist anywhere).
 * The fake IdP signs its answers with an HMAC (see fake.ts); these certificates stand in for the
 * IdP signing certificate a real SAML connection is configured with, so the settings page, the
 * metadata parser and the connection test see realistic values.
 */
export const FAKE_IDP_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICwjCCAaqgAwIBAgIUYsFoDbDJySSEV9jVjkQaHEhUn6MwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQWWF5YXRvaCBGYWtlIElkUDAeFw0yNTAxMDEwMDAwMDBa
Fw00NTAxMDEwMDAwMDBaMBsxGTAXBgNVBAMMEFlheWF0b2ggRmFrZSBJZFAwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+SpqEdSgOdx/GEk+NU34w+YiJ
DbKPk/K09wPa2c36kfpj0QYPvgnRLtb5abikxgHOvlfmr7cATAZNW3pkEOuw6C5d
Q0aFfr66jIMBoZSkJJShcynqXWhfkjKQemstnCM9nkQpqn+5MZ1bw6lfKLPvJwcu
GeGbbKw3QIMkb1K8PSJZiWikQaTHUaGZAitUlk9z6brpH/Y3UFtx1OMmgxAzgzk9
lxFh/nWGpem6MJypFK4KDmbEJHVQDRFVA6kCEDqEYynFKZDar0mPb0EYG0mjOqi1
M+EUk5WYS7A6MSEFYCRJJxiWVpWRpGgA7oHrtZi0kOW7NeVdUrBwIzAw2bpFAgMB
AAEwDQYJKoZIhvcNAQELBQADggEBAIChKewdVDnO8GOWmCLsiyghNySjaHfgauV5
941dDo/+SoQRzL9XQ/V5caumdVloN2ocKTJ9xIgiBPCWf+rbEAdYTuYgl4dND51i
4DxrTGNOFOpPjSkTE/kbpB8/XWab+fwJ3L7JF1jPwCQuNyDwKqLBO0QLzMIZKmVi
wZhgPCUP9Dgl+hzjBbP+YEyKEa9VGN9WfLW2uNIj4n+B4/k4lZAS8zBZSsxSt+aj
RQsVPGQKX/B3jIT3HiWJLO155H1/ftdy1v6TUtTyICXmEtp9JxqI28mjqi51f16a
VF6YRfza5hNkiJMl5JJxIMnmUa0+5EOcsqoQ1tZIVGsXdDM82Jk=
-----END CERTIFICATE-----`;

/** A certificate that expired on 2021-01-01 (the connection test refuses it). */
export const EXPIRED_IDP_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICwjCCAaqgAwIBAgIUUI7CAjEjyLbob4p9d9+sCgWcNTswDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQRXhwaXJlZCBGYWtlIElkUDAeFw0yMDAxMDEwMDAwMDBa
Fw0yMTAxMDEwMDAwMDBaMBsxGTAXBgNVBAMMEEV4cGlyZWQgRmFrZSBJZFAwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDOZMcIUgQP7IpiYKg6nZbyx4C2
dBcd3pZV8rotOjUhWKjXG5AaaDHjAbRBkmjcwimQ2l7zc08KpBM7FL3USSyEf7wO
rKiAa13gKHjaSda2Kf/Sp4a8QE33WazUOp/khAAgOcRD38xgKT5r8WIQ9D8/cfpR
7akmw/z4Dvjhc/Ee2b2UEGRaJhMNfYf2T64Hq5YuTxtkwGIvqwwNSn2kFZUbcvUX
T9iPnc7ZcRM/YU5bXHcgTnS24ZaTP4RzBDpIn5OB0Eq0qji1qph1FuludF9xrzSn
h2+utYa6nM3ydJqijBW15gU52aJQOfixxV6VvWpHJSIrxPCrGM9L1Ex8y7GPAgMB
AAEwDQYJKoZIhvcNAQELBQADggEBABFjM0cvM3iUSIjyI7BtF0btW1zDQGZ3roZO
ySj0bumo6/n8oOBO9VJuX+Soa4CX5AiK9/DoDi463gBUKhPww/dLNYigP6uUJMXi
6BkgYWRRiJzmnBpcRUOwmbBjdoUqk0R/RfNQxu92YhmODFn8jpzk4dNCtVVKmBu+
+Vu8XuE7ljmy6GGSpEP05VjfsH6th2ZQ37xt3dB3/6bLPUJe9qJhuQQwg1JPSt7H
UnRLdN1mYHrQVtz+HaNw4YWyomnlocf7e6owT1RrrVFejn0ZwLZ0WQNlotTPLqqp
PcWQGSybpEDdwy0pdD3DDKMVSXudrXkSJeFv7X2+cPsCS01SaHU=
-----END CERTIFICATE-----`;

/** The fake IdP's SAML metadata for an entity id (what an org admin would upload or link). */
export function fakeIdpMetadata(
  entityId: string,
  ssoUrl = `${entityId.replace(/\/$/, '')}/sso/saml`,
): string {
  const cert = FAKE_IDP_CERTIFICATE.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${ssoUrl}"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${ssoUrl}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
`;
}
