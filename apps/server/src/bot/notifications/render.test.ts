import { describe, expect, it } from 'vitest';
import { renderNotification } from './render.js';

const env = { BOT_USERNAME: 'AgroBotTest', MINIAPP_SHORT_NAME: 'app' };
const applicantId = '11111111-1111-4111-8111-111111111111';

describe('N1 renderer (PRD N1)', () => {
  it('names the applicant and offers Approve / Reject in the admin language', () => {
    const rendered = renderNotification(
      env,
      'N1',
      { applicantId, name: 'Marta Puig', username: 'marta' },
      'es',
    );
    expect(rendered.text).toContain('Marta Puig (@marta)');
    expect(rendered.text).toContain('Nueva solicitud');
    const buttons = rendered.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['✅ Aprobar', '❌ Rechazar']);
    expect(buttons.map((b) => 'callback_data' in b && b.callback_data)).toEqual([
      `approve:${applicantId}`,
      `reject:${applicantId}`,
    ]);
  });

  it('escapes a name that looks like markup (ARCH §17)', () => {
    const rendered = renderNotification(
      env,
      'N1',
      { applicantId, name: '<b>Pau</b> & co', username: null },
      'ca',
    );
    expect(rendered.text).toContain('&lt;b&gt;Pau&lt;/b&gt; &amp; co');
    expect(rendered.text).not.toContain('(@');
  });
});

describe('N2 renderer (PRD N2)', () => {
  it('welcomes an approved applicant with an Open AgroBot link', () => {
    const rendered = renderNotification(env, 'N2', { decision: 'approved', name: 'Marta' }, 'ca');
    expect(rendered.text).toContain('Benvingut/da');
    const [button] = rendered.replyMarkup?.inline_keyboard.flat() ?? [];
    expect(button?.text).toBe("Obre l'AgroBot");
    expect('url' in button! && button.url).toBe('https://t.me/AgroBotTest/app');
  });

  it('tells a rejected applicant politely, with no button', () => {
    const rendered = renderNotification(env, 'N2', { decision: 'rejected', name: 'Marta' }, 'es');
    expect(rendered.text).toContain('no ha sido aceptada');
    expect(rendered.replyMarkup).toBeUndefined();
  });
});

describe('catalogue notifications (N4, N5, N12)', () => {
  it.each(['ca', 'es'] as const)(
    'renders exact escaped proposals and admin links in %s',
    (language) => {
      const rendered = renderNotification(
        env,
        'N4',
        { productId: applicantId, name: 'Tomàquet <cor> & bou' },
        language,
      );
      expect(rendered.text).toContain('Tomàquet &lt;cor&gt; &amp; bou');
      expect(rendered.text).toContain(
        language === 'ca' ? 'Producte proposat' : 'Producto propuesto',
      );
      const [button] = rendered.replyMarkup!.inline_keyboard.flat();
      expect(button && 'url' in button && button.url).toContain('startapp=a_catalog');
    },
  );
  it.each(['resolved', 'rejected'] as const)(
    'renders %s N5 for a member without an admin link',
    (decision) => {
      const rendered = renderNotification(
        env,
        'N5',
        { productId: applicantId, name: '<Ous>', decision },
        'es',
      );
      expect(rendered.text).toContain('&lt;Ous&gt;');
      const [button] = rendered.replyMarkup!.inline_keyboard.flat();
      expect(button && 'url' in button && button.url).toBe('https://t.me/AgroBotTest/app');
    },
  );
  it('points failed sync notifications at the admin report', () => {
    const rendered = renderNotification(env, 'N12', { syncId: applicantId }, 'es');
    expect(rendered.text).toContain('conservado');
    expect(rendered.replyMarkup!.inline_keyboard[0]?.[0]).toMatchObject({
      url: 'https://t.me/AgroBotTest/app?startapp=a_catalog',
    });
  });
});

describe('offer notifications (N3, N10, N11)', () => {
  const offerId = '22222222-2222-4222-8222-222222222222';
  const product = {
    productName: 'Tomàquet <cor de bou>',
    productNameEs: 'Tomate',
    unitCode: 'kg' as const,
  };

  it('N3 names the producer, the quantity with its unit and the product in the reader language', () => {
    const ca = renderNotification(
      env,
      'N3',
      { ...product, offerId, producerName: 'Marta & Pau', quantity: 12.5, republished: false },
      'ca',
    );
    expect(ca.text).toBe('🧺 Marta &amp; Pau ofereix 12,5 kg de Tomàquet &lt;cor de bou&gt;.');
    const [button] = ca.replyMarkup!.inline_keyboard.flat();
    expect(button).toMatchObject({
      text: "Obre l'oferta",
      url: `https://t.me/AgroBotTest/app?startapp=o_${offerId}`,
    });

    const es = renderNotification(
      env,
      'N3',
      { ...product, offerId, producerName: 'Marta', quantity: 3, republished: true },
      'es',
    );
    expect(es.text).toBe('🧺 Marta vuelve a ofrecer 3 kg de Tomate.');
  });

  it('N10 asks "still available?" with Yes / Withdraw quick actions and the offer link', () => {
    const rendered = renderNotification(
      env,
      'N10',
      { ...product, productNameEs: null, unitCode: 'dozen', offerId, quantity: 4 },
      'es',
    );
    expect(rendered.text).toContain('4 docena de Tomàquet &lt;cor de bou&gt;');
    const rows = rendered.replyMarkup!.inline_keyboard;
    expect(rows[0]!.map((b) => 'callback_data' in b && b.callback_data)).toEqual([
      `still:${offerId}`,
      `withdraw:${offerId}`,
    ]);
    expect(rows[0]!.map((b) => b.text)).toEqual(['✅ Sí, todavía', '🗑 Retirarla']);
    expect(rows[1]![0]).toMatchObject({
      url: `https://t.me/AgroBotTest/app?startapp=o_${offerId}`,
    });
  });

  it('N11 lists the open reservations to resolve, with a plural that follows the count', () => {
    const one = renderNotification(
      env,
      'N11',
      { ...product, offerId, reservations: [{ requesterName: 'Jordi <j>', quantity: 2 }] },
      'ca',
    );
    expect(one.text).toBe(
      "Has retirat l'oferta de Tomàquet &lt;cor de bou&gt;. Té 1 reserva oberta, que cal resoldre:\n• Jordi &lt;j&gt;: 2 kg",
    );
    const two = renderNotification(
      env,
      'N11',
      {
        ...product,
        offerId,
        reservations: [
          { requesterName: 'Jordi', quantity: 2 },
          { requesterName: 'Pere', quantity: 3.5 },
        ],
      },
      'es',
    );
    expect(two.text).toContain('Tiene 2 reservas abiertas');
    expect(two.text).toContain('• Pere: 3,5 kg');
    expect(two.replyMarkup!.inline_keyboard[0]![0]).toMatchObject({
      text: 'Abrir las reservas',
      url: `https://t.me/AgroBotTest/app?startapp=o_${offerId}`,
    });
  });
});
