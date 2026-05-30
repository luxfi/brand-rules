package main

import (
	"fmt"

	// Cross-org tooling refs survive the line-level exemption.
	luxhsm "github.com/luxfi/hsm"
	hanzobase "github.com/hanzoai/base"
	_ "github.com/zooai/agents"
)

func main() {
	fmt.Println("Lux Network node up")
	_ = luxhsm.Version
	_ = hanzobase.Version
}
