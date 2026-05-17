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

const findDeep = <T extends Element>(
  selector: string,
  root: Document | ShadowRoot | Element
): T | null => {
  const direct = root.querySelector<T>(selector);
  if (direct) return direct;
  for (const element of Array.from(root.querySelectorAll<Element>('*'))) {
    if (element.shadowRoot) {
      const nested = findDeep<T>(selector, element.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
};

const getDeep = <T extends Element>(selector: string) =>
  cy.document().then({ timeout: 30000 }, (doc) => {
    return new Cypress.Promise<T>((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        const element = findDeep<T>(selector, doc);
        if (element) {
          resolve(element);
          return;
        }
        if (Date.now() - started > 30000) {
          reject(new Error(`Timed out finding ${selector}`));
          return;
        }
        window.setTimeout(poll, 250);
      };
      poll();
    });
  });

const setInputValue = (input: HTMLInputElement, value: string) => {
  input.focus();
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const getDeepText = <T extends Element>(selector: string, pattern: RegExp) =>
  cy.document().then({ timeout: 30000 }, (doc) => {
    return new Cypress.Promise<T>((resolve, reject) => {
      const collect = (root: Document | ShadowRoot | Element): T[] => {
        const matches = Array.from(root.querySelectorAll<T>(selector));
        for (const element of Array.from(root.querySelectorAll<Element>('*'))) {
          if (element.shadowRoot) matches.push(...collect(element.shadowRoot));
        }
        return matches;
      };
      const started = Date.now();
      const poll = () => {
        const element = collect(doc).find((candidate) =>
          pattern.test(candidate.textContent ?? '')
        );
        if (element) {
          resolve(element);
          return;
        }
        if (Date.now() - started > 30000) {
          reject(new Error(`Timed out finding ${selector} matching ${pattern}`));
          return;
        }
        window.setTimeout(poll, 250);
      };
      poll();
    });
  });

const login = () => {
  cy.visit('https://request.snape.tech/', { timeout: 60000 });
  getDeep<HTMLInputElement>('input').then((input) => {
    setInputValue(input, Cypress.env('LIVE_README_EMAIL'));
  });
  getDeepText<HTMLButtonElement>('button', /log in|continue|next/i).then((button) =>
    cy.wrap(button).click({ force: true })
  );
  getDeep<HTMLInputElement>('input[type="password"]').then((input) => {
    setInputValue(input, Cypress.env('LIVE_README_PASSWORD'));
  });
  getDeepText<HTMLButtonElement>('button', /log in|continue|next/i).then((button) =>
    cy.wrap(button).click({ force: true })
  );
  cy.location('hostname', { timeout: 60000 }).should('eq', 'request.snape.tech');
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

    cy.visit('https://request.snape.tech/discover/books');
    cy.contains(/Books/i, { timeout: 60000 }).should('be.visible');
    waitForImages();
    cy.screenshot('live-readme-books', { capture: 'viewport' });

    cy.visit('https://request.snape.tech/discover/music');
    cy.contains(/Music/i, { timeout: 60000 }).should('be.visible');
    waitForImages();
    cy.screenshot('live-readme-music', { capture: 'viewport' });
  });
});
