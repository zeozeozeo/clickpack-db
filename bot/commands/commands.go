package commands

import (
	"fmt"
	"log/slog"

	"github.com/disgoorg/disgo/handler"
)

func RegisterHandlers(r handler.Router) error {
	mux, ok := r.(*handler.Mux)
	if !ok {
		return fmt.Errorf("RegisterHandlers requires a *handler.Mux, but received %T", r)
	}

	mux.ButtonComponent("/reject/{id}", HandleReject)
	mux.ButtonComponent("/approve/{id}", HandleApprove)

	slog.Info("command handlers registered")
	return nil
}
