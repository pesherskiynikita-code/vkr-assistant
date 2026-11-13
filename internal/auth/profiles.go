package auth

import (
	"fmt"
	"time"
)

// SaveProfile: записать описание доски. Если доска уже есть, описание заменится.
func (s *Store) SaveProfile(boardID, description string) error {
	_, err := s.db.Exec(
		`INSERT INTO board_profiles (board_id, description, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(board_id) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at`,
		boardID, description, time.Now().Unix(),
	)
	return err
}

// Profiles: все сохранённые описания. Ключ — id доски, значение — описание.
func (s *Store) Profiles() (map[string]string, error) {
	rows, err := s.db.Query(`SELECT board_id, description FROM board_profiles`)
	if err != nil {
		return nil, fmt.Errorf("select profiles: %w", err)
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var id, desc string
		if err := rows.Scan(&id, &desc); err != nil {
			return nil, err
		}
		out[id] = desc
	}
	return out, rows.Err()
}
