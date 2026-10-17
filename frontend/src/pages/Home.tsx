import { ArrowRight, Construction } from "lucide-react";
import { Link } from "react-router-dom";
import { SystemStatus } from "@/components/SystemStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sections } from "@/sections";

export function Home() {
  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 sm:px-12 sm:py-20">
        <div
          aria-hidden
          className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl"
        />
        <div className="relative max-w-2xl space-y-6">
          <Badge>AI walking companion · Astana</Badge>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
            Discover Astana{" "}
            <span className="bg-gradient-to-r from-cyan-500 to-indigo-500 bg-clip-text text-transparent">
              Your Way
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            QalaQuest AI turns real places of the capital into walks that fit your interests, mood, budget and time.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/explore">
                Explore <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/planner">AI Planner</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">What's coming</h2>
          <Badge>
            <Construction className="h-3 w-3" /> in development
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map(({ path, label, icon: Icon, description }) => (
            <Link key={path} to={path} className="group">
              <Card className="h-full transition-colors group-hover:border-primary">
                <CardHeader>
                  <Icon className="mb-1 h-6 w-6 text-primary" />
                  <CardTitle>{label}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SystemStatus />
      </section>
    </div>
  );
}
