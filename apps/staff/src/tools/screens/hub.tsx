import { useTranslations } from 'use-intl';
import { useTools } from '../deps';
import { Body, Button, Card, Columns, Empty, Heading, Pane, Screen } from '../ui';

interface Tile {
  readonly id: string;
  readonly path: string;
}

/**
 * Door tools home (M7.4c): what this phone can do right now. An enrolled device gets the door
 * tools; a signed-in exhibitor rep gets lead retrieval; a signed-in organizer gets the event-day
 * view. Nothing else is listed.
 */
export function HubScreen() {
  const t = useTranslations('tools');
  const { device, portal, organizer, navigate } = useTools();
  const door: Tile[] = device
    ? [
        { id: 'lookup', path: '/tools/lookup' },
        { id: 'guests', path: '/tools/guests' },
        { id: 'assistance', path: '/tools/assistance' },
        { id: 'today', path: '/tools/today' },
      ]
    : [];
  const other: Tile[] = [
    ...(portal ? [{ id: 'leads', path: '/tools/leads' }] : []),
    ...(organizer ? [{ id: 'ops', path: '/tools/ops' }] : []),
  ];
  const tiles = [...door, ...other];

  return (
    <Screen testID="tools-hub">
      <Heading>{t('title')}</Heading>
      <Body muted>{t('hub.intro')}</Body>
      {tiles.length === 0 ? <Empty title={t('hub.none')} /> : null}
      <Columns>
        <Pane>
          {tiles.map((tile) => (
            <Card key={tile.id} testID={`tile-${tile.id}`}>
              <Heading level={2}>{t(`hub.${tile.id}`)}</Heading>
              <Body muted>{t(`hub.${tile.id}Hint`)}</Body>
              <Button
                label={t(`hub.${tile.id}`)}
                onPress={() => navigate(tile.path)}
                testID={`open-${tile.id}`}
              />
            </Card>
          ))}
        </Pane>
      </Columns>
    </Screen>
  );
}
