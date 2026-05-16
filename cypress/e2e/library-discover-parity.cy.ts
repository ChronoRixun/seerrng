describe('Books and Music discover parity', () => {
  const unrestrictedQuota = {
    movie: { used: 0, restricted: false },
    tv: { used: 0, restricted: false },
    music: { used: 0, restricted: false },
    book: { used: 0, restricted: false },
  };

  const serviceDetails = (serverName: string, path: string) => ({
    server: {
      id: 1,
      name: serverName,
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeMetadataProfileId: 1,
      activeDirectory: path,
      activeTags: [],
    },
    profiles: [{ id: 1, name: 'Default' }],
    metadataProfiles: [{ id: 1, name: 'Default' }],
    rootFolders: [{ id: 1, path, freeSpace: 1000000000 }],
    tags: [],
  });

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
    cy.intercept('GET', '/api/v1/book/OL1W', {
      id: 'OL1W',
      mediaType: 'book',
      title: 'Parity Book',
      author: 'Parity Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      isbnCandidates: [],
      subjects: [],
    }).as('getBookDetails');
    cy.get('[data-testid=title-card]').first().trigger('mouseover').click();
    cy.wait('@getBookDetails');
    cy.contains('[data-testid=media-title]', 'Parity Book').should(
      'be.visible'
    );

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
    cy.get('body').type('{esc}');
    cy.intercept('GET', '/api/v1/music/11111111-1111-1111-1111-111111111111', {
      id: '11111111-1111-1111-1111-111111111111',
      mbId: '11111111-1111-1111-1111-111111111111',
      mediaType: 'album',
      title: 'Parity Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Parity Artist',
      },
      tracks: [],
    }).as('getMusicDetails');
    cy.get('[data-testid=title-card]').first().trigger('mouseover').click();
    cy.wait('@getMusicDetails');
    cy.contains('[data-testid=media-title]', 'Parity Album').should(
      'be.visible'
    );
  });

  it('opens book and music request modals with matching workflow controls', () => {
    cy.intercept('GET', '/api/v1/user/*/quota', unrestrictedQuota);

    cy.intercept('GET', '/api/v1/book/OLREQW', {
      id: 'OLREQW',
      mediaType: 'book',
      title: 'Requestable Book',
      author: 'Request Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/2-L.jpg',
      isbn13: '9780000000002',
      editionId: 'OLREQM',
      isbnCandidates: [
        {
          isbn: '9780000000002',
          title: 'Requestable Book',
          editionId: 'OLREQM',
          format: 'hardcover',
        },
      ],
      subjects: ['fiction'],
    }).as('getRequestBook');
    cy.intercept('GET', '/api/v1/service/readarr', [
      {
        id: 1,
        name: 'Bookshelf Ebooks',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/books',
        activeTags: [],
        serviceType: 'ebook',
      },
      {
        id: 2,
        name: 'Bookshelf Audio',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/audiobooks',
        activeTags: [],
        serviceType: 'audiobook',
      },
    ]);
    cy.intercept('GET', '/api/v1/service/readarr/1', {
      ...serviceDetails('Bookshelf Ebooks', '/books'),
      server: {
        ...serviceDetails('Bookshelf Ebooks', '/books').server,
        serviceType: 'ebook',
      },
    });
    cy.intercept('GET', '/api/v1/service/readarr/2', {
      ...serviceDetails('Bookshelf Audio', '/audiobooks'),
      server: {
        ...serviceDetails('Bookshelf Audio', '/audiobooks').server,
        id: 2,
        serviceType: 'audiobook',
      },
    });

    cy.visit('/book/OLREQW');
    cy.wait('@getRequestBook');
    cy.contains('[data-testid=media-title]', 'Requestable Book').should(
      'be.visible'
    );
    cy.contains('button', 'Request').click();
    cy.contains('[data-testid=modal-title]', 'Request Book').should(
      'be.visible'
    );
    cy.contains('[data-testid=modal-title]', 'Requestable Book').should(
      'be.visible'
    );
    cy.contains('label', 'Format').should('be.visible');
    cy.get('select[name=bookFormat]').should('be.visible');
    cy.contains('label', 'Edition / ISBN').should('be.visible');
    cy.get('select[name=isbn]').should('be.visible');
    cy.contains('Automatic best match').should('be.visible');
    cy.contains('Advanced').should('be.visible');
    cy.get('[data-testid=modal-cancel-button]').click();

    cy.intercept('GET', '/api/v1/music/33333333-3333-3333-3333-333333333333', {
      id: '33333333-3333-3333-3333-333333333333',
      mbId: '33333333-3333-3333-3333-333333333333',
      mediaType: 'album',
      title: 'Requestable Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '44444444-4444-4444-4444-444444444444',
        name: 'Request Artist',
      },
      tracks: [{ position: 1, name: 'Track One', recordingMbid: 'track-1' }],
    }).as('getRequestMusic');
    cy.intercept('GET', '/api/v1/service/lidarr', [
      {
        id: 1,
        name: 'Lidarr',
        is4k: false,
        isDefault: true,
        activeProfileId: 1,
        activeMetadataProfileId: 1,
        activeDirectory: '/music',
        activeTags: [],
      },
    ]);
    cy.intercept('GET', '/api/v1/service/lidarr/1', {
      ...serviceDetails('Lidarr', '/music'),
    });

    cy.visit('/music/33333333-3333-3333-3333-333333333333');
    cy.wait('@getRequestMusic');
    cy.contains('[data-testid=media-title]', 'Requestable Album').should(
      'be.visible'
    );
    cy.contains('button', 'Request').click();
    cy.contains('[data-testid=modal-title]', 'Request Music').should(
      'be.visible'
    );
    cy.contains(
      '[data-testid=modal-title]',
      'Request Artist - Requestable Album'
    ).should('be.visible');
    cy.get('[data-testid=modal-ok-button]').should('contain', 'Request');
    cy.get('[data-testid=modal-cancel-button]').should('contain', 'Cancel');
  });
});
