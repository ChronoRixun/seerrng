const palettes = [
  'Aurora',
  'Ember',
  'Lagoon',
  'Orchid',
  'Forest',
  'Sapphire',
  'Rosewood',
  'Citrus',
  'Arctic',
  'Grape',
  'Coral',
  'Mint',
  'Steel',
  'Gold',
  'Plum',
  'Skyline',
  'Moss',
  'Flame',
  'Violet',
  'Ocean',
];

describe('Headless theme verification', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMovies');
    cy.visit('/discover/movies', {
      onBeforeLoad(win) {
        win.localStorage.removeItem('seerr-theme-mode');
        win.localStorage.removeItem('seerr-theme-palette');
      },
    });
    cy.wait('@getMovies');
  });

  it('renders controls and gives every palette a unique light/dark pair', () => {
    cy.viewport(1400, 900);

    cy.get('button[aria-label="Theme picker"]').then(($themeButton) => {
      cy.get('[data-testid=user-menu]').then(($userButton) => {
        const themeBounds = $themeButton[0].getBoundingClientRect();
        const userBounds = $userButton[0].getBoundingClientRect();
        expect(themeBounds.right).to.be.lessThan(userBounds.left);
        expect(themeBounds.width).to.equal(40);
        expect(userBounds.width).to.be.greaterThan(30);
      });
    });

    cy.get('button[aria-label="Theme picker"]').click();
    cy.contains('button', 'Aurora').should('be.visible');
    cy.get('body').type('{esc}');

    cy.get('[data-testid=user-menu]').click();
    cy.contains('a', 'Sign Out').should('be.visible');
    cy.get('body').type('{esc}');

    const seenPairs = new Set<string>();
    const snapshots: {
      palette: string;
      accentPair: string;
      darkBackground: string;
      lightBackground: string;
    }[] = [];

    cy.wrap(palettes).each((paletteName) => {
      cy.get('button[aria-label="Theme picker"]').click();
      cy.contains('button', paletteName).click();
      cy.get('html').then(($html) => {
        const styles = getComputedStyle($html[0]);
        const accentPair = `${styles.getPropertyValue('--color-indigo-600').trim()}|${styles.getPropertyValue('--color-purple-600').trim()}`;
        const darkBackground = styles
          .getPropertyValue('--color-gray-900')
          .trim();
        expect(
          seenPairs.has(accentPair),
          `${paletteName} accent pair is unique`
        ).to.eq(false);
        seenPairs.add(accentPair);

        cy.get('button[aria-label="Theme picker"]').click();
        cy.contains('button', 'Dark mode').click();
        cy.get('html').then(($lightHtml) => {
          const lightStyles = getComputedStyle($lightHtml[0]);
          const lightPair = `${lightStyles.getPropertyValue('--color-indigo-600').trim()}|${lightStyles.getPropertyValue('--color-purple-600').trim()}`;
          const lightBackground = lightStyles
            .getPropertyValue('--color-gray-900')
            .trim();
          expect(lightPair).to.eq(accentPair);
          expect(lightBackground).not.to.eq(darkBackground);
          snapshots.push({
            palette: paletteName as string,
            accentPair,
            darkBackground,
            lightBackground,
          });

          cy.get('button[aria-label="Theme picker"]').click();
          cy.contains('button', 'Light mode').click();
        });
      });
    });

    cy.then(() => {
      expect(seenPairs.size).to.eq(20);
      cy.writeFile('/tmp/seerrng-theme-check/palette-results.json', snapshots);
    });
  });
});
