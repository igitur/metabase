import { restore } from "e2e/support/helpers";

describe("scenarios > browse data", () => {
  beforeEach(() => {
    restore();
    cy.signInAsAdmin();
  });

  it("can browse to model", () => {
    cy.visit("/");
    cy.findByRole("listitem", { name: "Browse data" }).click();
    cy.location("pathname").should("eq", "/browse");
    cy.findByRole("heading", { name: "Browse data" });
    cy.findByRole("heading", { name: "Orders Model" }).click();
    cy.findByRole("button", { name: "Filter" });
  });
  it("can view summary of model's last edit", () => {
    cy.visit("/");
    cy.findByRole("listitem", { name: "Browse data" }).click();
    // TODO: Change from "7" to "7h"
    const editSummary = cy.findByText(/Bobby Tables.*7/);
    editSummary.realHover();
    cy.findByRole("tooltip", { name: /Last edited by Bobby Tables/ });
  });
  it("can browse to a database", () => {
    cy.visit("/");
    cy.findByRole("listitem", { name: "Browse data" }).click();
    cy.findByRole("tab", { name: "Databases" }).click();
    cy.findByRole("heading", { name: "Sample Database" }).click();
    cy.findByRole("heading", { name: "Products" }).click();
    cy.findByRole("button", { name: "Summarize" });
    cy.findByRole("link", { name: /Sample Database/ }).click();
  });
  it("can visit 'Learn about our data' page", () => {
    cy.visit("/");
    cy.findByRole("listitem", { name: "Browse data" }).click();
    cy.findByRole("link", { name: /Learn about our data/ }).click();
    cy.location("pathname").should("eq", "/reference/databases");
    cy.go("back");
    cy.findByRole("tab", { name: "Databases" }).click();
    cy.findByRole("heading", { name: "Sample Database" }).click();
    cy.findByRole("heading", { name: "Products" }).click();
    cy.findByRole("gridcell", { name: "Rustic Paper Wallet" });
  });
});
