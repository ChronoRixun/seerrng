describe('Books and Music discover parity', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
  });

  it('matches the video discover toolbar shape for books and music', () => {
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    }).as('getMovies');
    cy.visit('/discover/movies');
    cy.wait('@getMovies');
    cy.contains('[data-testid=page-header]', 'Movies').should('be.visible');
    cy.get('select[name=sortBy]').should('be.visible');
    cy.contains('button', '0 Active Filters').click();
    cy.contains('Filters').should('be.visible');
    cy.contains('Release Date').should('be.visible');
    cy.get('body').type('{esc}');

    cy.intercept('GET', '/api/v1/discover/books*', {
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [
        {
          id: 'OL1W',
          mediaType: 'book',
          title: 'Parity Book',
          author: 'Parity Author',
          firstPublishYear: 2026,
          posterPath: 'https://covers.openlibrary.org/b/id/1-L.jpg',
        },
      ],
    }).as('getBooks');
    cy.visit('/discover/books');
    cy.wait('@getBooks');
    cy.contains('[data-testid=page-header]', 'Books').should('be.visible');
    cy.get('select[name=subject]').should('be.visible');
    cy.contains('button', '0 Active Filters').click();
    cy.contains('Filters').should('be.visible');
    cy.get('label[for=book-discover-query]').should('be.visible');
    cy.contains('Subject').should('be.visible');
    cy.get('input[name=book-discover-query]').type('left hand');
    cy.contains('button', 'Search').should('be.visible');
    cy.get('body').type('{esc}');

    cy.intercept('GET', '/api/v1/discover/music*', {
      page: 1,
      totalPages: 1,
      totalResults: 1,
      results: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          mediaType: 'album',
          title: 'Parity Album',
          'primary-type': 'Album',
          'first-release-date': '2026-05-01',
          'artist-credit': [{ name: 'Parity Artist' }],
        },
      ],
    }).as('getMusic');
    cy.visit('/discover/music');
    cy.wait('@getMusic');
    cy.contains('[data-testid=page-header]', 'Music').should('be.visible');
    cy.get('select[name=sortBy]').should('be.visible');
    cy.contains('button', '0 Active Filters').click();
    cy.contains('Filters').should('be.visible');
    cy.get('label[for=music-discover-query]').should('be.visible');
    cy.contains('Release Window').should('be.visible');
    cy.get('input[name=music-discover-query]').type('kind of blue');
    cy.contains('button', 'Search').should('be.visible');
  });
});
