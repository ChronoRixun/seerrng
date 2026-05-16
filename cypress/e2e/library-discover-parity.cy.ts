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

  it('keeps request list media filters addressable for book and music queues', () => {
    cy.intercept('GET', '/api/v1/request*', (req) => {
      req.reply({
        pageInfo: { pages: 1, pageSize: 10, results: 0, page: 1 },
        results: [],
        serviceErrors: {
          radarr: [],
          sonarr: [],
          lidarr: [],
          readarr: [],
        },
      });
    }).as('getRequests');

    cy.visit('/requests?mediaType=book&filter=pending');
    cy.wait('@getRequests')
      .its('request.url')
      .should('include', 'mediaType=book')
      .and('include', 'filter=pending');
    cy.get('select[name=mediaType]').should('have.value', 'book');
    cy.get('select[name=filter]').should('have.value', 'pending');

    cy.get('select[name=mediaType]').select('music');
    cy.wait('@getRequests')
      .its('request.url')
      .should('include', 'mediaType=music');
    cy.location('search').should('include', 'mediaType=music');
  });

  it('shows book and music download status in manage slideovers', () => {
    const downloadStatus = {
      mediaType: 'book',
      externalId: 101,
      size: 100,
      sizeLeft: 40,
      status: 'downloading',
      timeLeft: '10:00',
      estimatedCompletionTime: '2026-05-16T12:00:00.000Z',
      title: 'Managed Book',
      downloadId: 'book-download',
    };

    cy.intercept('GET', '/api/v1/book/OLMANAGEW', {
      id: 'OLMANAGEW',
      mediaType: 'book',
      title: 'Managed Book',
      author: 'Manage Author',
      firstPublishYear: 2026,
      posterPath: 'https://covers.openlibrary.org/b/id/3-L.jpg',
      isbnCandidates: [],
      subjects: [],
      mediaInfo: {
        id: 9001,
        status: 3,
        serviceUrl: 'http://bookshelf.local/book/1',
        audiobookServiceUrl: 'http://bookshelf.local/audio/1',
        downloadStatus: [downloadStatus],
        audiobookDownloadStatus: [
          {
            ...downloadStatus,
            externalId: 102,
            title: 'Managed Book Audio',
            downloadId: 'audio-download',
          },
        ],
        requests: [],
        issues: [],
      },
    }).as('getManagedBook');

    cy.visit('/book/OLMANAGEW?manage=1');
    cy.wait('@getManagedBook');
    cy.contains('Manage book').should('be.visible');
    cy.contains('Downloads').should('be.visible');
    cy.contains('Managed Book (Ebook)').should('be.visible');
    cy.contains('Managed Book (Audiobook)').should('be.visible');
    cy.contains('Open Ebook in Bookshelf').should('be.visible');
    cy.get('body').type('{esc}');

    cy.intercept('GET', '/api/v1/music/55555555-5555-5555-5555-555555555555', {
      id: '55555555-5555-5555-5555-555555555555',
      mbId: '55555555-5555-5555-5555-555555555555',
      mediaType: 'album',
      title: 'Managed Album',
      type: 'Album',
      releaseDate: '2026-05-01',
      artist: {
        id: '66666666-6666-6666-6666-666666666666',
        name: 'Manage Artist',
      },
      tracks: [],
      mediaInfo: {
        id: 9002,
        status: 3,
        serviceUrl: 'http://lidarr.local/album/1',
        downloadStatus: [
          {
            ...downloadStatus,
            mediaType: 'music',
            externalId: 201,
            title: 'Managed Album',
            downloadId: 'music-download',
          },
        ],
        requests: [],
        issues: [],
      },
    }).as('getManagedMusic');

    cy.visit('/music/55555555-5555-5555-5555-555555555555?manage=1');
    cy.wait('@getManagedMusic');
    cy.contains('Manage music').should('be.visible');
    cy.contains('Downloads').should('be.visible');
    cy.contains('Managed Album').should('be.visible');
    cy.contains('Open in Lidarr').should('be.visible');
  });

  it('keeps the top search bar global across video, books, and music', () => {
    cy.intercept('GET', '/api/v1/discover/movies*', {
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
    cy.intercept('GET', '/api/v1/search*', {
      page: 1,
      totalPages: 1,
      totalResults: 3,
      results: [
        {
          id: 501,
          mediaType: 'movie',
          title: 'Global Movie',
          releaseDate: '2026-01-01',
          posterPath: null,
          overview: 'Movie result',
        },
        {
          id: '77777777-7777-7777-7777-777777777777',
          mediaType: 'album',
          title: 'Global Album',
          'primary-type': 'Album',
          'first-release-date': '2026-02-01',
          'artist-credit': [{ name: 'Global Artist' }],
        },
        {
          id: 'OLGLOBALW',
          mediaType: 'book',
          title: 'Global Book',
          author: 'Global Author',
          firstPublishYear: 2026,
          posterPath: 'https://covers.openlibrary.org/b/id/4-L.jpg',
        },
      ],
    }).as('globalSearch');

    cy.visit('/discover/movies');
    cy.get('input#search_field').type('global');
    cy.wait('@globalSearch')
      .its('request.url')
      .should('include', 'query=global');
    cy.location('pathname').should('eq', '/search');
    cy.contains('[data-testid=title-card-title]', 'Global Movie').should(
      'be.visible'
    );
    cy.contains('[data-testid=title-card-title]', 'Global Album').should(
      'be.visible'
    );
    cy.contains('Global Book').should('be.visible');
  });
});
