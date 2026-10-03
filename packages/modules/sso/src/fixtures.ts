/**
 * Recorded fake IdP material (M6.5a): public certificates only (no private keys exist anywhere).
 * The fake IdP signs its answers with an HMAC (see fake.ts); these certificates stand in for the
 * IdP signing certificate a real SAML connection is configured with, so the settings page, the
 * metadata parser and the connection test see realistic values.
 */
export const FAKE_IDP_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDFzCCAf+gAwIBAgIUJ+1UCgyIDcqNbUeNMCmkXoILFSIwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQWWF5YXRvaCBGYWtlIElkUDAeFw0yNjEwMDMxNzU3NDJa
Fw0zNjA5MzAxNzU3NDJaMBsxGTAXBgNVBAMMEFlheWF0b2ggRmFrZSBJZFAwggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCQZ5duyvKowqEs+LxtgCJtWTMV
PD8XHiOGGGNvH2tuqVa3EbB7kFiBwvIPtmVxymfy6Q7x5v3CF8xNI0hpS+Ik/qCm
U/3/6Kn/RZN9ZcUY3CJiPlyff242mxACUbU3MzggJMBe/SzBN5DoU1bUYxpZm5Oe
MQbXD6tZ3G5YoZsaopNbSE7B4lkAJMzZLQ/c9f/LE95dnRvtwgB/v4VwMWaKfkh7
0vtrXCC5IQWBcHi2PkZBqF9p0dZGiGFpRVpuz/pycwYTIWmjK4timSbbrWvM+/i6
JILMTzKfGLqY+q+Edm7yWixYfkOzFG+P7GWwohE4CF5a8KGw9NwolaH/LwUBAgMB
AAGjUzBRMB0GA1UdDgQWBBQTEmKyjMFpUr54Ag4VRYl9QQ+1gjAfBgNVHSMEGDAW
gBQTEmKyjMFpUr54Ag4VRYl9QQ+1gjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4IBAQBVcpngCcygvF55yz63SgvFJPWDGGIDE+pZaoF4wOoBnB3xYyDe
RG3KkbZewfWYgnI4gnW8Gmtv9SW0TBHzUIyesNl2hb91iDvGl6VILY9UcRQpR4pF
WJjNPhWMOsvxYIQHW6+vMFShHDOdDcDNdyYWv2xSs90AjcMcqYrRz/k9Kfmi9SF+
0tNqowbnMaHhOJ1c47fHQ3x74RsRm1njAEKL5o26QZ36u2A+9npxWDEPcCKNnIC3
eq02D0fLFD2lkaCqa9ba5/+rlYCBAWhJDvvbjCqfLqXPBda0ptPJ++Ro/2qgmeEq
Tqu5wsm8HRGAaxEJCPkkQmcdYSy2vbLq58Uj
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
export function fakeIdpMetadata(entityId: string, ssoUrl = `${entityId.replace(/\/$/, '')}/sso/saml`): string {
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
