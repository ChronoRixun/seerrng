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
