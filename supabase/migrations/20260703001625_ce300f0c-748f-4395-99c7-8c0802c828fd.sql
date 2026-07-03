
CREATE TABLE public.games (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  category TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.games TO authenticated;
GRANT ALL ON public.games TO service_role;

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view active games"
  ON public.games FOR SELECT
  TO authenticated
  USING (is_active OR public.current_user_has_role('admin'));

CREATE POLICY "Admins can insert games"
  ON public.games FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "Admins can update games"
  ON public.games FOR UPDATE
  TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE POLICY "Admins can delete games"
  ON public.games FOR DELETE
  TO authenticated
  USING (public.current_user_has_role('admin'));

CREATE TRIGGER games_set_updated_at
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.games (title, url, thumbnail_url, category, description, sort_order) VALUES
  ('2048', 'https://play2048.co/', 'https://play2048.co/meta/apple-touch-icon.png', 'Puzzle', 'Slide tiles and reach 2048.', 10),
  ('Chess.com', 'https://www.chess.com/play/online', 'https://images.chesscomfiles.com/uploads/v1/images_users/tiny_mce/PedroPinhata/phpkXqXbC.png', 'Board', 'Play chess online.', 20),
  ('Wordle (NYT)', 'https://www.nytimes.com/games/wordle/index.html', 'https://www.nytimes.com/games-assets/v2/assets/wordle/wordle-social-static.png', 'Word', 'Guess the 5-letter word.', 30),
  ('Sudoku', 'https://sudoku.com/', 'https://sudoku.com/favicons/apple-touch-icon.png', 'Puzzle', 'Classic number puzzle.', 40),
  ('Slither.io', 'http://slither.io/', 'https://slither.io/s/apple-touch-icon.png', 'Arcade', 'Grow the longest snake.', 50),
  ('Krunker.io', 'https://krunker.io/', 'https://assets.krunker.io/textures/logo_1024.png', 'Shooter', 'Fast-paced browser FPS.', 60);
