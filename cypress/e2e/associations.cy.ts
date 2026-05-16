const associationGraph = {
  root: {
    mediaType: 'book',
    id: 'OLROOTW',
    title: 'Root Book',
  },
  edges: [
    {
      weight: 0.9,
      type: 'shared-person',
      reason: 'Also by Book Author',
      node: {
        id: 'OLRELATEDW',
        mediaType: 'book',
        title: 'Related Book',
        author: 'Book Author',
        authorId: 'OLAUTHOR',
        firstPublishYear: 2024,
        posterPath: 'https://covers.openlibrary.org/b/id/123-L.jpg',
      },
    },
    {
      weight: 0.8,
      type: 'similar',
      reason: 'Similar title',
      node: {
        id: 'OLOTHERW',
        mediaType: 'book',
        title: 'Adjacent Book',
        author: 'Another Author',
        firstPublishYear: 2022,
        posterPath: 'https://covers.openlibrary.org/b/id/456-L.jpg',
      },
    },
  ],
};

describe('Associations', () => {
  beforeEach(() => {
    cy.loginAsAdmin();
    cy.intercept(
      'GET',
      '/api/v1/association/book/OLROOTW?includeWeak=true',
      associationGraph
    ).as('getAssociations');
    cy.intercept(
      'GET',
      '/api/v1/association/book/OLRELATEDW?includeWeak=true',
      {
        root: {
          mediaType: 'book',
          id: 'OLRELATEDW',
          title: 'Related Book',
        },
        edges: [
          {
            weight: 0.8,
            type: 'shared-person',
            reason: 'Also by Book Author',
            node: {
              id: 'OLROOTW',
              mediaType: 'book',
              title: 'Root Book',
              author: 'Book Author',
              posterPath: 'https://covers.openlibrary.org/b/id/789-L.jpg',
            },
          },
        ],
      }
    ).as('getRelatedAssociations');
  });

  it('shows same-author book associations in the wall view', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.contains('h1', 'Associations for Root Book').should('be.visible');
    cy.get('[data-testid=association-wall]').within(() => {
      cy.contains('Same author').should('be.visible');
      cy.get('[data-testid=title-card]').last().trigger('mouseover');
      cy.contains('[data-testid=title-card-title]', 'Related Book').should(
        'be.visible'
      );
    });
    cy.contains('[data-testid=title-card-title]', 'Related Book')
      .parents('.space-y-2')
      .contains('Explore connections')
      .should('have.attr', 'href', '/associations/book/OLRELATEDW')
      .and('be.visible');
  });

  it('opens card association popovers outside clipped title cards', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.get('[data-testid=association-wall]').within(() => {
      cy.get('[data-testid=title-card]').last().trigger('mouseover');
      cy.get('[data-testid=association-badge]').last().click();
    });

    cy.wait('@getRelatedAssociations');
    cy.get('body > [data-testid=association-popover]')
      .should('be.visible')
      .and(($popover) => {
        expect($popover[0].getBoundingClientRect().width).to.be.greaterThan(
          250
        );
      });
    cy.contains('[data-testid=association-popover]', 'Root Book').should(
      'be.visible'
    );
  });

  it('renders the graph view with a legend and recenterable nodes', () => {
    cy.visit('/associations/book/OLROOTW');
    cy.wait('@getAssociations');

    cy.contains('button', 'Map').click();
    cy.get('[data-testid=association-graph]').should('be.visible');
    cy.get('[data-testid=association-graph-legend]').within(() => {
      cy.contains('Shared person').should('be.visible');
      cy.contains('Similar').should('be.visible');
    });
    cy.contains('[data-testid=association-graph-node]', 'Related Book')
      .should('be.visible')
      .click();
  });
});
