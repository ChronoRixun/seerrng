const response = <T>(results: T[]) => ({
  page: 1,
  totalPages: 1,
  totalResults: results.length,
  results,
});

const bookTitles = [
  ['The Clockwork Sea', 'M. L. Arden'],
  ['Wuthering Heights', 'Emily Bronte'],
  ['A Murder of Maps', 'Iris Vale'],
  ['The Time Machine', 'H. G. Wells'],
  ['Ends With Us', 'Colleen Hoover'],
  ['The Invisible Man', 'H. G. Wells'],
  ['Diary of a Wimpy Kid', 'Jeff Kinney'],
  ['The Silent Patient', 'Alex Michaelides'],
  ['Powerless', 'Lauren Roberts'],
  ['Red White & Royal Blue', 'Casey McQuiston'],
  ['The Cruel Prince', 'Holly Black'],
  ['They Both Die at the End', 'Adam Silvera'],
  ['Shatter Me', 'Tahereh Mafi'],
  ['Unravel Me', 'Tahereh Mafi'],
  ['The Summer I Turned Pretty', 'Jenny Han'],
  ['The Eyes of Darkness', 'Dean Koontz'],
  ['The Scarlet Letter', 'Nathaniel Hawthorne'],
  ['The Wizard of Oz', 'L. Frank Baum'],
  ['The Secret Garden', 'Frances Hodgson Burnett'],
  ['The Great Gatsby', 'F. Scott Fitzgerald'],
  ['A Good Girl’s Guide to Murder', 'Holly Jackson'],
  ['Mrs Dalloway', 'Virginia Woolf'],
  ['Project Hail Mary', 'Andy Weir'],
  ['Tomorrow and Tomorrow and Tomorrow', 'Gabrielle Zevin'],
];

const albumTitles = [
  ['Meteora', 'Linkin Park'],
  ['Hybrid Theory', 'Linkin Park'],
  ['Thriller', 'Michael Jackson'],
  ['Nevermind', 'Nirvana'],
  ['Random Access Memories', 'Daft Punk'],
  ['Channel Orange', 'Frank Ocean'],
  ['Discovery', 'Daft Punk'],
  ['Rumours', 'Fleetwood Mac'],
  ['Blue', 'Joni Mitchell'],
  ['Kid A', 'Radiohead'],
  ['Currents', 'Tame Impala'],
  ['Blonde', 'Frank Ocean'],
  ['Melodrama', 'Lorde'],
  ['To Pimp a Butterfly', 'Kendrick Lamar'],
  ['In Rainbows', 'Radiohead'],
  ['Norman Rockwell!', 'Lana Del Rey'],
  ['The Fame', 'Lady Gaga'],
  ['DAMN.', 'Kendrick Lamar'],
  ['Sour', 'Olivia Rodrigo'],
  ['After Hours', 'The Weeknd'],
  ['Abbey Road', 'The Beatles'],
  ['OK Computer', 'Radiohead'],
  ['The Miseducation', 'Lauryn Hill'],
  ['Lemonade', 'Beyonce'],
];

const baseUrl = 'http://localhost:5055';

const books = bookTitles.map(([title, author], index) => ({
  id: `OLREADME${index + 1}W`,
  mediaType: 'book',
  title,
  author,
  firstPublishYear: 2000 + index,
  posterPath: `${baseUrl}/readme-covers/book-${index + 1}.png`,
}));

const albums = albumTitles.map(([title, artist], index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  mediaType: 'album',
  title,
  'primary-type': 'Album',
  'first-release-date': `${2000 + index}-05-01`,
  releaseDate: String(2000 + index),
  posterPath: `${baseUrl}/readme-covers/album-${index + 1}.png`,
  'artist-credit': [{ name: artist }],
}));

const movies = books.slice(0, 18).map((book, index) => ({
  id: 9000 + index,
  mediaType: index % 3 === 0 ? 'tv' : 'movie',
  title: book.title,
  name: book.title,
  overview: `A featured SeerrNG pick for the README preview.`,
  releaseDate: `${2020 + (index % 6)}-01-01`,
  firstAirDate: `${2020 + (index % 6)}-01-01`,
  voteAverage: 7.8,
  posterPath: book.posterPath,
}));

const installMocks = () => {
  cy.intercept('GET', '/api/v1/settings/discover', [
    { id: 1, type: 4, enabled: true, isBuiltIn: true, order: 0 },
    { id: 2, type: 22, enabled: true, isBuiltIn: true, order: 1 },
    { id: 3, type: 23, enabled: true, isBuiltIn: true, order: 2 },
  ]);
  cy.intercept('GET', '/api/v1/discover/trending*', response(movies));
  cy.intercept('GET', '/api/v1/discover/movies*', response(movies));
  cy.intercept('GET', '/api/v1/discover/tv*', response(movies));
  cy.intercept('GET', '/api/v1/discover/books*', response(books));
  cy.intercept('GET', '/api/v1/discover/music*', response(albums));
  cy.intercept('GET', '/api/v1/user/*/settings/card-text', {
    movie: 'hover',
    tv: 'hover',
    album: 'always',
    book: 'always',
  });
};

const waitForImages = () => {
  cy.get('[data-testid=title-card] img:visible')
    .should('have.length.greaterThan', 8)
    .then({ timeout: 20000 }, ($images) => {
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
              }, 15000);

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

describe('README screenshots', () => {
  beforeEach(() => {
    cy.viewport(1920, 1080);
    cy.loginAsAdmin();
    installMocks();
  });

  it('captures the discover panel', () => {
    cy.visit('/');
    cy.contains('Recommended Music').should('be.visible');
    cy.contains('Recommended Books').should('be.visible');
    cy.get('[data-testid=title-card]').should('have.length.greaterThan', 20);
    cy.contains('Recommended Music').scrollIntoView();
    cy.contains('Meteora').should('be.visible');
    cy.contains('The Clockwork Sea').should('be.visible');
    waitForImages();
    cy.wait(1000);
    cy.screenshot('readme-discover', { capture: 'viewport' });
  });

  it('captures the books pane', () => {
    cy.visit('/discover/books');
    cy.contains('[data-testid=page-header]', 'Books').should('be.visible');
    cy.get('[data-testid=title-card]').should('have.length.greaterThan', 20);
    waitForImages();
    cy.screenshot('readme-books', { capture: 'viewport' });
  });

  it('captures the music pane', () => {
    cy.visit('/discover/music');
    cy.contains('[data-testid=page-header]', 'Music').should('be.visible');
    cy.get('[data-testid=title-card]').should('have.length.greaterThan', 20);
    waitForImages();
    cy.screenshot('readme-music', { capture: 'viewport' });
  });
});
