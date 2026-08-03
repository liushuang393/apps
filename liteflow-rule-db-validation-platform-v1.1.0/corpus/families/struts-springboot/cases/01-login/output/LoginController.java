package generated;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/login")
public class LoginController {

    @GetMapping
    public String show(@ModelAttribute("form") LoginForm form) {
        return "login";
    }

    @PostMapping
    public String submit(@ModelAttribute("form") LoginForm form, Model model) {
        if (form.getUserId() == null) {
            return "login";
        }
        model.addAttribute("userId", form.getUserId());
        return "menu";
    }
}
