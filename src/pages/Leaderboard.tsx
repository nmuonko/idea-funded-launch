import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trophy, Star, TrendingUp, MapPin } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function Leaderboard() {
  const { data: topProjects, isLoading } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_submissions')
        .select('id, project_title, project_description, category, country, city_province, ai_overall_score, ai_impact_score, ai_feasibility_score, project_type, submitted_at')
        .eq('payment_status', 'paid')
        .eq('is_draft', false)
        .not('ai_overall_score', 'is', null)
        .gte('ai_overall_score', 60) // Only show projects with score >= 60
        .order('ai_overall_score', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const getRankBadge = (index: number) => {
    if (index === 0) return <Badge className="bg-yellow-500 hover:bg-yellow-600">🥇 1st</Badge>;
    if (index === 1) return <Badge className="bg-gray-400 hover:bg-gray-500">🥈 2nd</Badge>;
    if (index === 2) return <Badge className="bg-amber-600 hover:bg-amber-700">🥉 3rd</Badge>;
    return <Badge variant="outline">#{index + 1}</Badge>;
  };

  const getScoreBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-green-600">Excellent</Badge>;
    if (score >= 80) return <Badge className="bg-blue-600">Very Good</Badge>;
    if (score >= 70) return <Badge className="bg-purple-600">Good</Badge>;
    return <Badge variant="secondary">Fair</Badge>;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4">
            <Trophy className="h-10 w-10 text-primary" />
            <h1 className="text-4xl font-bold">Project Leaderboard</h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
            Discover the most innovative and impactful project ideas from entrepreneurs across Africa.
            Rankings are based on AI-powered evaluation of innovation, feasibility, and potential impact.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
            <Star className="h-4 w-4" />
            <span>All applicant information is kept confidential</span>
          </div>
        </div>

        {/* Top 3 Podium */}
        {topProjects && topProjects.length >= 3 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 max-w-5xl mx-auto">
            {/* 2nd Place */}
            <Card className="transform md:translate-y-8 shadow-lg">
              <CardHeader className="text-center pb-4">
                <div className="text-6xl mb-2">🥈</div>
                <CardTitle className="text-xl">2nd Place</CardTitle>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-2xl font-bold">{topProjects[1].ai_overall_score}/100</span>
                </div>
              </CardHeader>
              <CardContent>
                <h3 className="font-semibold text-lg mb-2">{topProjects[1].project_title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {topProjects[1].project_description}
                </p>
                <div className="space-y-2">
                  {topProjects[1].country && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{topProjects[1].country}</span>
                    </div>
                  )}
                  {topProjects[1].category && (
                    <Badge variant="outline">{topProjects[1].category}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 1st Place */}
            <Card className="shadow-xl border-2 border-primary">
              <CardHeader className="text-center pb-4">
                <div className="text-7xl mb-2">🥇</div>
                <CardTitle className="text-2xl">1st Place</CardTitle>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Star className="h-6 w-6 text-yellow-500 fill-yellow-500" />
                  <span className="text-3xl font-bold text-primary">{topProjects[0].ai_overall_score}/100</span>
                </div>
              </CardHeader>
              <CardContent>
                <h3 className="font-semibold text-xl mb-2">{topProjects[0].project_title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {topProjects[0].project_description}
                </p>
                <div className="space-y-2">
                  {topProjects[0].country && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{topProjects[0].country}</span>
                    </div>
                  )}
                  {topProjects[0].category && (
                    <Badge variant="outline">{topProjects[0].category}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 3rd Place */}
            <Card className="transform md:translate-y-8 shadow-lg">
              <CardHeader className="text-center pb-4">
                <div className="text-6xl mb-2">🥉</div>
                <CardTitle className="text-xl">3rd Place</CardTitle>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                  <span className="text-2xl font-bold">{topProjects[2].ai_overall_score}/100</span>
                </div>
              </CardHeader>
              <CardContent>
                <h3 className="font-semibold text-lg mb-2">{topProjects[2].project_title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                  {topProjects[2].project_description}
                </p>
                <div className="space-y-2">
                  {topProjects[2].country && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{topProjects[2].country}</span>
                    </div>
                  )}
                  {topProjects[2].category && (
                    <Badge variant="outline">{topProjects[2].category}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Full Leaderboard Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Top 50 Projects
            </CardTitle>
            <CardDescription>
              Ranked by overall AI evaluation score (Innovation + Feasibility + Impact)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!topProjects || topProjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Trophy className="h-16 w-16 mx-auto mb-4 opacity-20" />
                <p>No projects have been evaluated yet. Check back soon!</p>
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Rank</TableHead>
                      <TableHead>Project Title</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-center">Rating</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topProjects.map((project, index) => (
                      <TableRow key={project.id}>
                        <TableCell>{getRankBadge(index)}</TableCell>
                        <TableCell className="font-medium">{project.project_title}</TableCell>
                        <TableCell className="max-w-md">
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {project.project_description}
                          </p>
                        </TableCell>
                        <TableCell>
                          {project.country && (
                            <div className="flex items-center gap-1 text-sm">
                              <MapPin className="h-3 w-3" />
                              {project.country}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {project.category && (
                            <Badge variant="outline" className="text-xs">
                              {project.category}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                            <span className="font-bold text-lg">{project.ai_overall_score}</span>
                            <span className="text-muted-foreground text-sm">/100</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {getScoreBadge(project.ai_overall_score)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="mt-8 bg-muted/50">
          <CardHeader>
            <CardTitle className="text-lg">About the Leaderboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <strong>🤖 AI Evaluation:</strong> Projects are scored using advanced AI analysis that evaluates innovation, feasibility, and potential social impact.
            </p>
            <p>
              <strong>🔒 Privacy:</strong> All applicant personal information (names, contact details, specific funding amounts) is kept confidential.
            </p>
            <p>
              <strong>📊 Criteria:</strong> Projects must score 60+ to appear on the leaderboard. Scores reflect: Innovation (30%), Feasibility (35%), and Impact (35%).
            </p>
            <p>
              <strong>⚡ Updates:</strong> Rankings update in real-time as new projects are submitted and evaluated.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
