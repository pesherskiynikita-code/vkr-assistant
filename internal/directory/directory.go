package directory

import (
	"encoding/json"
	"fmt"
	"os"
)

type entry struct {
	ID          string `json:"id"`
	Description string `json:"description"`
}

func Load(path string) (map[string]string, error) {
	result := map[string]string{}
	if path == "" {
		return result, nil
	}
	data, err := os.ReadFile(path)            
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var entries []entry
	if err := json.Unmarshal(data, &entries); err != nil { 
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	for _, e := range entries {
		result[e.ID] = e.Description                
	}
	return result, nil
}