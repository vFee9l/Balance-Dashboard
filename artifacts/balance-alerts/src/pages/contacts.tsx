import { useState } from "react";
import { 
  useListContacts, 
  getListContactsQueryKey,
  useCreateContact,
  useUpdateContact,
  useDeleteContact
} from "@workspace/api-client-react";
import type { Contact, ContactInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Edit2, Trash2, Shield, User, Crown } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const contactSchema = z.object({
  fullName: z.string().min(1, "Name is required"),
  phoneNumber: z.string().min(1, "Phone is required"),
  email: z.string().email("Invalid email").or(z.literal("")),
  position: z.string(),
  role: z.enum(["staff", "manager", "md"])
});

export default function Contacts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const { data: contacts, isLoading } = useListContacts({
    query: { queryKey: getListContactsQueryKey() }
  });

  const createContactMutation = useCreateContact();
  const updateContactMutation = useUpdateContact();
  const deleteContactMutation = useDeleteContact();

  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      fullName: "",
      phoneNumber: "",
      email: "",
      position: "",
      role: "staff"
    }
  });

  const openAddModal = () => {
    setEditingContact(null);
    form.reset({ fullName: "", phoneNumber: "", email: "", position: "", role: "staff" });
    setIsModalOpen(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    form.reset({
      fullName: contact.fullName,
      phoneNumber: contact.phoneNumber,
      email: contact.email,
      position: contact.position,
      role: contact.role as "staff" | "manager" | "md"
    });
    setIsModalOpen(true);
  };

  const onSubmit = async (data: z.infer<typeof contactSchema>) => {
    try {
      if (editingContact) {
        await updateContactMutation.mutateAsync({ id: editingContact.id, data });
        toast({ title: "Contact updated successfully" });
      } else {
        await createContactMutation.mutateAsync({ data: data as ContactInput });
        toast({ title: "Contact created successfully" });
      }
      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
      setIsModalOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving contact",
        description: error.message || "Unknown error occurred"
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteContactMutation.mutateAsync({ id });
      toast({ title: "Contact deleted successfully" });
      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error deleting contact",
        description: error.message || "Unknown error occurred"
      });
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "md": return <Crown className="w-3 h-3 mr-1" />;
      case "manager": return <Shield className="w-3 h-3 mr-1" />;
      default: return <User className="w-3 h-3 mr-1" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "md": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "manager": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      default: return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notification Roster</h1>
          <p className="text-muted-foreground mt-1">Manage who receives alerts based on severity thresholds.</p>
        </div>
        <Button onClick={openAddModal} className="font-bold tracking-wider">
          <Plus className="mr-2 h-4 w-4" /> ADD CONTACT
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Name</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Phone</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Email</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Position</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase">Role/Escalation</TableHead>
                <TableHead className="font-mono text-xs font-semibold tracking-wider text-muted-foreground uppercase text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : contacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No contacts configured. Add contacts to start routing alerts.
                  </TableCell>
                </TableRow>
              ) : (
                contacts?.map((contact) => (
                  <TableRow key={contact.id} className="border-border/50 hover:bg-muted/50 transition-colors">
                    <TableCell className="font-medium text-foreground">{contact.fullName}</TableCell>
                    <TableCell className="font-mono text-sm">{contact.phoneNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{contact.email || "-"}</TableCell>
                    <TableCell>{contact.position || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`uppercase text-[10px] tracking-widest font-bold ${getRoleColor(contact.role)}`}>
                        {getRoleIcon(contact.role)}
                        {contact.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditModal(contact)}>
                        <Edit2 className="h-4 w-4 text-muted-foreground hover:text-primary" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-border">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove contact?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. {contact.fullName} will no longer receive alerts.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(contact.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" className="bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" className="bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="john@example.com" type="email" className="bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Position (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="NOC Engineer" className="bg-background" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Escalation Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="staff">Staff (Warning Alerts)</SelectItem>
                        <SelectItem value="manager">Manager (Critical Alerts)</SelectItem>
                        <SelectItem value="md">MD (Emergency Alerts)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end pt-4">
                <Button type="button" variant="outline" className="mr-2" onClick={() => setIsModalOpen(false)}>
                  CANCEL
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "SAVING..." : "SAVE CONTACT"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}