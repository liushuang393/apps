package generated;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/search")
public class SearchController {

    @GetMapping
    public String show(@ModelAttribute("form") SearchForm form) {
        return "search";
    }

    @PostMapping
    public String submit(@ModelAttribute("form") SearchForm form, Model model) {
        model.addAttribute("keyword", form.getKeyword());
        model.addAttribute("rows", form.getRows());
        return "search";
    }
}
