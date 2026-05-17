const waitForImages = () => {
  cy.get('img:visible', { timeout: 30000 })
    .should('have.length.greaterThan', 8)
    .then({ timeout: 30000 }, ($images) => {
      const images = ($images.toArray() as HTMLImageElement[]).filter(
        (image) => image.currentSrc || image.src
      );

      return Cypress.Promise.all(
        images.map(
          (image) =>
            new Cypress.Promise<void>((resolve, reject) => {
              if (image.complete && image.naturalWidth > 0) {
                resolve();
                return;
              }

              const timeout = window.setTimeout(() => {
                reject(new Error(`Timed out loading image: ${image.currentSrc || image.src}`));
              }, 25000);

              image.addEventListener(
                'load',
                () => {
                  window.clearTimeout(timeout);
                  resolve();
                },
                { once: true }
              );
              image.addEventListener(
                'error',
                () => {
                  window.clearTimeout(timeout);
                  reject(new Error(`Failed loading image: ${image.currentSrc || image.src}`));
                },
                { once: true }
              );
            })
        )
      );
    });
};

const login = () => {
  cy.visit('http://192.168.50.85:5055/login', { timeout: 60000 });
  cy.location('pathname', { timeout: 60000 }).then((pathname) => {
    if (pathname === '/login') {
      cy.get('input[placeholder*="Email" i], input[type="email"]', { timeout: 30000 })
        .first()
        .clear()
        .type(Cypress.env('LIVE_README_EMAIL'));
      cy.get('input[placeholder*="Password" i], input[type="password"]')
        .first()
        .clear()
        .type(Cypress.env('LIVE_README_PASSWORD'), { log: false });
      cy.contains('button', /sign in|login/i).click();
    }
  });
};

describe('live README screenshots', () => {
  beforeEach(() => {
    cy.viewport(1920, 1080);
  });

  it('captures live discover, books, and music', () => {
    login();

    cy.contains(/Music|Discover|Movies|Books/i, { timeout: 60000 }).should('be.visible');
    waitForImages();
    cy.screenshot('live-readme-discover', { capture: 'viewport' });

    cy.visit('http://192.168.50.85:5055/discover/books');
    cy.contains(/Books/i, { timeout: 60000 }).should('be.visible');
    waitForImages();
    cy.screenshot('live-readme-books', { capture: 'viewport' });

    cy.visit('http://192.168.50.85:5055/discover/music');
    cy.contains(/Music/i, { timeout: 60000 }).should('be.visible');
    waitForImages();
    cy.screenshot('live-readme-music', { capture: 'viewport' });
  });
});
