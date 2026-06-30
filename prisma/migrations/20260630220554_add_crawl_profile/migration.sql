-- CreateTable
CREATE TABLE "CrawlProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rootUrl" TEXT NOT NULL,
    "productPattern" TEXT NOT NULL DEFAULT '',
    "categoryPattern" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
