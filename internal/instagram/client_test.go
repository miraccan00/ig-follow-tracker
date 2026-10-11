package instagram

import "testing"

func TestNoSession(t *testing.T) {
	c, e := New()
	if e != nil {
		t.Fatal(e)
	}
	if c.cookie("sessionid") != "" {
		t.Fatal("unexpected session")
	}
}

