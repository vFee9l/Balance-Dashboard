import { Router } from "express";
import { db, contactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListContactsResponseItem,
  CreateContactBody,
  UpdateContactBody,
  GetContactParams,
  UpdateContactParams,
  DeleteContactParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/contacts", async (req, res): Promise<void> => {
  const contacts = await db.select().from(contactsTable).orderBy(contactsTable.createdAt);
  const parsed = contacts.map((c) => ListContactsResponseItem.parse({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));
  res.json(parsed);
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [contact] = await db.insert(contactsTable).values(parsed.data).returning();
  res.status(201).json({
    ...contact,
    createdAt: contact.createdAt.toISOString(),
  });
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, params.data.id));
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json({ ...contact, createdAt: contact.createdAt.toISOString() });
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = UpdateContactBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [updated] = await db
    .update(contactsTable)
    .set(body.data)
    .where(eq(contactsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db
    .delete(contactsTable)
    .where(eq(contactsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.status(204).send();
});

export default router;
