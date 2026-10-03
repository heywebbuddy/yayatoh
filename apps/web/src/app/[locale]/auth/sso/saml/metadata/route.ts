import { NextResponse } from 'next/server';
import { serviceProvider } from '@/server/sso.ts';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Our SAML service provider metadata (M6.5a), for IdPs that import it instead of typing URLs. */
export async function GET() {
  const sp = serviceProvider();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${esc(sp.entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(sp.acsUrl)}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`;
  return new NextResponse(xml, {
    headers: {
      'content-type': 'application/samlmetadata+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
