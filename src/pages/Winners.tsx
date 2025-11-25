import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trophy, MapPin, DollarSign } from 'lucide-react';

export default function Winners() {
  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions-with-winners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('id, name, start_date')
        .order('start_date', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const { data: winners, isLoading: winnersLoading } = useQuery({
    queryKey: ['all-published-winners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('winners')
        .select('*, sessions(name, start_date)')
        .eq('is_published', true)
        .order('year', { ascending: false })
        .order('display_order');
      
      if (error) throw error;
      return data;
    },
  });

  if (sessionsLoading || winnersLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Group winners by session
  const winnersBySession = winners?.reduce((acc: any, winner: any) => {
    const sessionId = winner.session_id;
    if (!acc[sessionId]) {
      acc[sessionId] = [];
    }
    acc[sessionId].push(winner);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mb-4">
            <Trophy className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold">AfriFund Winners</h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Celebrating entrepreneurs who are transforming communities across Africa through innovation and determination.
          </p>
        </div>

        {/* Winners by Session */}
        {sessions?.map((session) => {
          const sessionWinners = winnersBySession?.[session.id] || [];
          
          if (sessionWinners.length === 0) return null;

          return (
            <div key={session.id} className="mb-16">
              <div className="flex items-center gap-3 mb-6">
                <Badge variant="outline" className="text-lg px-4 py-2">
                  {session.name}
                </Badge>
                <span className="text-muted-foreground">
                  {new Date(session.start_date).getFullYear()}
                </span>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {sessionWinners.map((winner: any) => (
                  <Card key={winner.id} className="overflow-hidden hover:shadow-lg transition-shadow">
                    {winner.image_url && (
                      <div className="aspect-video w-full overflow-hidden bg-muted">
                        <img
                          src={winner.image_url}
                          alt={winner.winner_name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <CardHeader>
                      <CardTitle className="flex items-start justify-between gap-2">
                        <span>{winner.winner_name}</span>
                        <Trophy className="h-5 w-5 text-primary flex-shrink-0" />
                      </CardTitle>
                      <CardDescription className="text-base font-medium text-foreground">
                        {winner.project_name}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{winner.country}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                        <DollarSign className="h-4 w-4" />
                        <span>${winner.award_amount.toLocaleString()} Award</span>
                      </div>
                      {winner.short_quote && (
                        <blockquote className="text-sm italic text-muted-foreground border-l-2 border-primary pl-3 mt-3">
                          "{winner.short_quote}"
                        </blockquote>
                      )}
                      {winner.testimonial_text && (
                        <p className="text-sm text-muted-foreground mt-2">
                          {winner.testimonial_text}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          );
        })}

        {(!winners || winners.length === 0) && (
          <Card className="text-center py-12">
            <CardContent>
              <Trophy className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground text-lg">
                No winners have been announced yet. Check back soon!
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
